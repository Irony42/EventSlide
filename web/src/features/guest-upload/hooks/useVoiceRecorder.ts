import { useCallback, useEffect, useRef, useState } from 'react'
import { createVoiceMeter, type VoiceMeter } from '../voiceMeter'
import {
  MIN_VOICE_MS,
  VOICE_WARNING_BEFORE_END_SECONDS,
  voiceCapSeconds,
  microphoneForbiddenByPage,
  pickVoiceFormat,
} from '../voiceRecording'

/**
 * Recording a voice message with `MediaRecorder` (spec 25, sections 3 and 5): the microphone, the
 * clock, the stop, and what was recorded.
 *
 * **No rule of the product lives here.** The ceiling of a message, the count a guest may leave and
 * whether the event takes one are the server's answers; this hook records what the guest says, for at
 * most the box's own limit ({@link voiceCapSeconds}, sixty at the very most), and hands the bytes to the screen. The traps it holds, each with a
 * test:
 *
 * - **The duration is the phone's own timer**, never `audio.duration`: a WebM from `MediaRecorder`
 *   reports `Infinity`, and Safari's fragmented MP4 not much better.
 * - **No `timeslice` is required**: Safari often delivers a single `dataavailable`, at the stop. One is
 *   asked for (every second) only so what was recorded survives a tab that dies.
 * - **The microphone is released at every stop**, by the button, at sixty seconds or when the page is
 *   hidden: the notice promises it only runs while recording, and on iOS an open stream keeps the
 *   volume of the preview low.
 * - **A hidden page stops the recording and keeps what there is** (a locked screen, an incoming call):
 *   `interrupted` tells the screen to say so on the guest's return.
 * - **A refusal and a forbidden page are two failures.** A guest who said no can change it in their
 *   settings; a page whose Permissions-Policy shuts the microphone cannot.
 */

export type VoicePhase = 'idle' | 'requesting' | 'recording' | 'recorded'

/** Why there is nothing to listen to, when there is not. */
export type VoiceFailure = 'denied' | 'blockedByPolicy' | 'unavailable' | 'tooShort'

export interface VoiceRecording {
  readonly blob: Blob
  /** What the recorder produced (`audio/mp4`, `audio/webm;codecs=opus`…): a hint, never read by the server. */
  readonly mimeType: string
  /** The phone's own measure, in milliseconds. */
  readonly durationMs: number
  /** The page was left while recording, which stopped it: the screen says so. */
  readonly interrupted: boolean
}

export interface VoiceRecorderOptions {
  /** Epoch milliseconds. Injected so a test never depends on a wall clock. */
  readonly now?: () => number
  /** The longest message the server said it takes (`voiceMaxSeconds`); the recorder stops at the smaller of it and sixty. */
  readonly serverMaxSeconds?: number | undefined
}

export interface VoiceRecorderState {
  readonly phase: VoicePhase
  readonly elapsedMs: number
  /** 0 to 1, from the analyser; always 0 where the browser has none. */
  readonly level: number
  /** The last ten seconds: said once, to a screen reader and in words. */
  readonly nearEnd: boolean
  readonly recording: VoiceRecording | null
  readonly failure: VoiceFailure | null
  readonly start: () => Promise<void>
  readonly stop: () => void
  /** Throws the recording away ("Recommencer") and clears a failure. Nothing has left the phone. */
  readonly reset: () => void
}

/** How often the clock and the level are read. A displayed second changes at most once per tick. */
const TICK_MS = 250
/** One `dataavailable` a second, to keep what has been said if the tab dies. */
const TIMESLICE_MS = 1_000

/** The error names a browser raises for "no": a refusal, a policy, or no device at all. */
const failureOf = (cause: unknown): VoiceFailure => {
  const name = cause instanceof DOMException || cause instanceof Error ? cause.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return microphoneForbiddenByPage() ? 'blockedByPolicy' : 'denied'
  }
  return 'unavailable'
}

export const useVoiceRecorder = (options: VoiceRecorderOptions = {}): VoiceRecorderState => {
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [level, setLevel] = useState(0)
  const [recording, setRecording] = useState<VoiceRecording | null>(null)
  const [failure, setFailure] = useState<VoiceFailure | null>(null)

  const clock = useRef(options.now ?? Date.now)
  useEffect(() => {
    clock.current = options.now ?? Date.now
  })

  /** Where the phone stops: a recording the server then refused as too long would be a lost one. */
  const maxMs = useRef(voiceCapSeconds(options.serverMaxSeconds) * 1_000)
  useEffect(() => {
    maxMs.current = voiceCapSeconds(options.serverMaxSeconds) * 1_000
  })

  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const meter = useRef<VoiceMeter | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const chunks = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const stoppedAt = useRef<number | null>(null)
  const interrupted = useRef(false)
  /** Which attempt is the live one: a press that resolves after "Recommencer" or an unmount is dropped. */
  const attempt = useRef(0)

  /** Releases the microphone and the clock. Idempotent, and called on every way out. */
  const release = useCallback(() => {
    if (timer.current !== null) clearInterval(timer.current)
    timer.current = null
    for (const track of stream.current?.getTracks() ?? []) track.stop()
    stream.current = null
    meter.current?.close()
    meter.current = null
  }, [])

  /** Ends the recorder if it is running; what it recorded arrives through its `stop` event. */
  const finish = useCallback((byInterruption: boolean) => {
    const live = recorder.current
    if (live === null || live.state === 'inactive') return
    if (byInterruption) interrupted.current = true
    stoppedAt.current = clock.current()
    live.stop()
  }, [])

  const reset = useCallback(() => {
    attempt.current += 1
    const live = recorder.current
    recorder.current = null
    if (live !== null && live.state !== 'inactive') {
      // The stop event of a discarded recording must not resurrect it.
      live.ondataavailable = null
      live.onstop = null
      live.stop()
    }
    release()
    chunks.current = []
    interrupted.current = false
    stoppedAt.current = null
    setPhase('idle')
    setElapsedMs(0)
    setLevel(0)
    setRecording(null)
    setFailure(null)
  }, [release])

  const start = useCallback(async () => {
    if (phase === 'requesting' || phase === 'recording') return
    reset()
    const mine = attempt.current
    setPhase('requesting')
    // Inside the tap, before the permission prompt: see `createVoiceMeter`.
    const liveMeter = createVoiceMeter()
    let microphone: MediaStream
    try {
      microphone = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (cause) {
      liveMeter?.close()
      if (attempt.current !== mine) return
      setFailure(failureOf(cause))
      setPhase('idle')
      return
    }
    if (attempt.current !== mine) {
      // Left or restarted while the prompt was open: the stream must not stay open behind it.
      for (const track of microphone.getTracks()) track.stop()
      liveMeter?.close()
      return
    }

    const format = pickVoiceFormat((type) => MediaRecorder.isTypeSupported(type))
    if (format === null) {
      for (const track of microphone.getTracks()) track.stop()
      liveMeter?.close()
      setFailure('unavailable')
      setPhase('idle')
      return
    }

    let made: MediaRecorder
    try {
      made = new MediaRecorder(microphone, { mimeType: format })
    } catch {
      for (const track of microphone.getTracks()) track.stop()
      liveMeter?.close()
      setFailure('unavailable')
      setPhase('idle')
      return
    }

    stream.current = microphone
    meter.current = liveMeter
    liveMeter?.attach(microphone)
    recorder.current = made
    chunks.current = []
    interrupted.current = false
    stoppedAt.current = null

    made.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) chunks.current.push(event.data)
    }
    made.onerror = () => {
      if (attempt.current !== mine) return
      release()
      recorder.current = null
      setFailure('unavailable')
      setPhase('idle')
    }
    made.onstop = () => {
      if (attempt.current !== mine) return
      const mimeType = made.mimeType === '' ? format : made.mimeType
      const measured = Math.min(
        maxMs.current,
        (stoppedAt.current ?? clock.current()) - startedAt.current,
      )
      const blob = new Blob(chunks.current, { type: mimeType })
      release()
      recorder.current = null
      setLevel(0)
      setElapsedMs(measured)
      if (blob.size === 0) {
        setFailure('unavailable')
        setPhase('idle')
      } else if (measured < MIN_VOICE_MS) {
        // A press by mistake is not a message, and the server's floor says the same.
        setFailure('tooShort')
        setPhase('idle')
      } else {
        setRecording({ blob, mimeType, durationMs: measured, interrupted: interrupted.current })
        setPhase('recorded')
      }
    }

    startedAt.current = clock.current()
    made.start(TIMESLICE_MS)
    setElapsedMs(0)
    setPhase('recording')
    timer.current = setInterval(() => {
      const elapsed = clock.current() - startedAt.current
      setElapsedMs(Math.min(elapsed, maxMs.current))
      setLevel(meter.current?.read() ?? 0)
      // The phone stops at the box's limit (sixty seconds at most), without losing a word.
      if (elapsed >= maxMs.current) finish(false)
    }, TICK_MS)
  }, [phase, reset, release, finish])

  const stop = useCallback(() => finish(false), [finish])

  // A page that is hidden stops the recording and keeps it (spec 25, trap d).
  useEffect(() => {
    if (phase !== 'recording') return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') finish(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [phase, finish])

  // Leaving the screen must not leave the microphone open.
  useEffect(
    () => () => {
      attempt.current += 1
      const live = recorder.current
      if (live !== null && live.state !== 'inactive') {
        live.ondataavailable = null
        live.onstop = null
        live.stop()
      }
      release()
    },
    [release],
  )

  return {
    phase,
    elapsedMs,
    level,
    nearEnd:
      phase === 'recording' &&
      elapsedMs >=
        (voiceCapSeconds(options.serverMaxSeconds) - VOICE_WARNING_BEFORE_END_SECONDS) * 1_000,
    recording,
    failure,
    start,
    stop,
    reset,
  }
}
