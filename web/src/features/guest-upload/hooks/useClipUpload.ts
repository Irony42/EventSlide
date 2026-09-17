import { useCallback, useEffect, useRef, useState } from 'react'
import { useApi } from '../../../app/useApi'
import { ApiError } from '../../../lib/http'
import { messageForCode, type UiText } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import {
  mayAnswerDifferently,
  megabytes,
  refuseClipDuration,
  refuseClipFile,
  type ClipLimits,
  type ClipRefusal,
} from '../clipFile'
import { probeClipDuration } from './probeClipDuration'

/**
 * One clip, from the moment the guest picks it to the moment the box has finished with
 * it.
 *
 * View-state, not a rule — the same contract `useUploadQueue` holds. What the box will
 * accept, how long a clip may run and whether these bytes are already there are the
 * server's answers; this hook owns what the guest can see and press while those answers
 * are on their way.
 *
 * Three things here are the whole feature, and each one exists because of a way the
 * naive version fails a guest standing in a room:
 *
 * 1. **Refuse before the bytes.** Size, and duration where the browser can read it. A
 *    `413` after four minutes of venue Wi-Fi has already cost the guest the four minutes.
 * 2. **Poll the real states.** `202` is not "sent": the clip is then `queued`, then
 *    `running`, and only then is there a photo. A screen that stops at 100% and says
 *    nothing for forty seconds is a screen whose guest sends the same file again.
 * 3. **`429` is not their fault.** `clip.queueFull` means the box is busy and clears in
 *    about a minute; it arrives with the server's own `Retry-After`, and the surface
 *    offers to try again rather than reporting a failure.
 *
 * And one thing it deliberately does **not** do: hand the bytes to the offline outbox.
 * See `web/src/lib/offline/outboxPolicy.ts` — a phone holding eighty megabytes it can
 * never drain is a phone that never sends anything else either.
 */

/** Where the clip is, in the guest's terms. The middle three are the server's own. */
export type ClipStage =
  | 'idle'
  /** Chosen and checked, waiting for the guest to press "Envoyer". */
  | 'ready'
  | 'uploading'
  /** The three non-terminal job states, verbatim from `GET .../clips/:id`. */
  | 'reserved'
  | 'queued'
  | 'running'
  | 'done'
  /**
   * The box is full and asked for a delay — `429 clip.queueFull`, with its own
   * `Retry-After`.
   *
   * Its own stage rather than a failure, because the guest's move is different and so is
   * the cost of getting it wrong. **The bytes travel before the refusal**: multer writes
   * the upload to disk and only then does the use case decide the queue depth, so a guest
   * who presses again immediately pushes eighty megabytes up a venue's Wi-Fi a second
   * time to be told the same thing. So no send is offered until the delay the server
   * asked for has passed — which is what "respect the `Retry-After`" has to mean on a
   * surface where the retry is a person rather than a loop.
   */
  | 'waiting'
  /** Refused, here or by the server. `message` says why; `retryable` says whether to offer. */
  | 'failed'

export interface ClipUpload {
  /** The recording in hand, or `null`. Kept through a failure, so a retry has bytes. */
  readonly file: File | null
  readonly stage: ClipStage
  /** 0-100, from the transport's upload progress events. */
  readonly progress: number
  /** A French sentence, ready to render. `null` while there is nothing to say. */
  readonly message: string | null
  /** Whether offering "Réessayer" would be honest. */
  readonly retryable: boolean
  readonly choose: (file: File) => void
  readonly clear: () => void
  readonly send: (caption: string | null) => void
  readonly cancel: () => void
}

export interface UseClipUploadOptions {
  readonly slug: string
  readonly limits: ClipLimits
  /** Called once the box has produced a photo, so "Vos envois" can pick it up. */
  readonly onArrived?: () => void
  /**
   * Reads a recording's duration. Injected because jsdom has no media pipeline, which is
   * the only reason this hook can be tested at all; the default is the real thing.
   */
  readonly probe?: (file: File) => Promise<number | null>
  /** Milliseconds between polls of the job. Injected so a test does not wait. */
  readonly pollIntervalMs?: number
}

/**
 * How often to ask "where is my clip?".
 *
 * Two seconds: a transcode of fifteen seconds of 720p on a venue mini-PC is measured in
 * seconds, and the guest is standing there looking at the screen. Slower and the
 * "Traitement" state looks stuck; faster and a room full of phones is polling a box that
 * is already busy encoding for them.
 */
const POLL_INTERVAL_MS = 2_000

/**
 * Stages during which a second press of "Envoyer" must do nothing.
 *
 * The bytes are either going up or already on the box; starting again would push the
 * same eighty megabytes a second time, which is the one repetition this whole surface is
 * built to avoid. The button shows its busy state for the same reason — a control that
 * silently ignores a tap is a control people tap harder.
 */
const BUSY: readonly ClipStage[] = ['uploading', 'reserved', 'queued', 'running', 'waiting']

/**
 * The `Retry-After` to use when the server did not put one in the refusal.
 *
 * The domain's own floor is one second (`retryAfterSecondsFor` never answers zero,
 * because `Retry-After: 0` is an invitation to hammer the endpoint that just said no), so
 * this is only reached if a proxy rewrote the body — and a second's pause is still better
 * than none.
 */
const FALLBACK_RETRY_SECONDS = 1

/**
 * How long to keep asking where a clip is before saying so.
 *
 * Three minutes. A fifteen-second clip is transcoded in seconds, and the retry ladder is
 * three attempts with a ten-second backoff — so a job still moving at three minutes is a
 * box under load or a phone that lost the venue's Wi-Fi, and neither is worth a poll
 * every two seconds for the rest of the evening. The clip is not abandoned by this; only
 * the watching is, and the guest is told where it will turn up.
 */
const MAX_WATCH_MS = 3 * 60 * 1000

const refusalMessage = (refusal: ClipRefusal, limits: ClipLimits, t: UiText): string => {
  const messages: Readonly<Record<ClipRefusal, () => string>> = {
    notAVideo: () => t.upload.clipNotAVideo,
    // The server answers this one with a code of its own, so the phone says what the
    // server would have said rather than inventing a second sentence for it.
    empty: () => messageForCode('clip.sourceByteSizeInvalid', t),
    tooLarge: () => t.upload.clipTooLarge(megabytes(limits.maxBytes)),
    tooLong: () => t.upload.clipTooLong(limits.maxSeconds),
  }
  return messages[refusal]()
}

interface Snapshot {
  readonly file: File | null
  readonly stage: ClipStage
  readonly progress: number
  readonly message: string | null
  readonly retryable: boolean
}

const IDLE: Snapshot = { file: null, stage: 'idle', progress: 0, message: null, retryable: false }

export const useClipUpload = (options: UseClipUploadOptions): ClipUpload => {
  const { slug, limits, onArrived, probe = probeClipDuration, pollIntervalMs } = options
  const t = useTranslations()
  const api = useApi()

  const [state, setState] = useState<Snapshot>(IDLE)

  /**
   * Everything that outlives a render, because the send is one long asynchronous run and
   * a closure over rendered state is a snapshot of the past.
   *
   * `run` is a monotonic counter rather than a boolean: a guest who cancels and picks
   * another recording starts a second run while the first one's `await` is still in the
   * air, and "am I still the current run?" is the only question that answers correctly.
   * A boolean here is the bug `useOutbox` documents at length.
   */
  const run = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The `Retry-After` the box asked for, as one armed timer. See the `waiting` stage. */
  const backoff = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * The recording in hand, outside React state.
   *
   * The duration probe resolves on its own schedule and has to know whether the file it
   * measured is still the one on screen. State is a snapshot of the past by then, and the
   * run counter answers a different question — see `choose`.
   */
  const chosen = useRef<File | null>(null)
  /**
   * When the box said it would take another clip, as an epoch instant.
   *
   * Deliberately **not** cleared by `abandon`, by `clear` or by choosing a different
   * recording. `Retry-After` is a fact about the queue on the server, not about the file
   * in hand, so a guest who takes the video back and picks another one has not made the
   * queue any shorter — and without this the whole delay was two taps away from being
   * bypassed, which is the same full upload spent to be refused again.
   */
  const blockedUntil = useRef(0)
  const latest = useRef({ onArrived })

  useEffect(() => {
    latest.current = { onArrived }
  })

  const stopTimers = useCallback(() => {
    if (poll.current !== null) clearTimeout(poll.current)
    poll.current = null
    if (backoff.current !== null) clearTimeout(backoff.current)
    backoff.current = null
  }, [])

  /** Abandons whatever is in flight. Used by cancel, by a new pick, and by unmount. */
  const abandon = useCallback(() => {
    run.current += 1
    controller.current?.abort()
    controller.current = null
    stopTimers()
  }, [stopTimers])

  useEffect(() => abandon, [abandon])

  const choose = useCallback(
    (file: File) => {
      abandon()
      chosen.current = file
      const refusal = refuseClipFile(file, limits)
      if (refusal !== null) {
        // Kept on screen with the file that caused it: a guest who is told "trop longue"
        // with nothing selected cannot tell which of the two they just picked was wrong.
        setState({
          file,
          stage: 'failed',
          progress: 0,
          message: refusalMessage(refusal, limits, t),
          retryable: false,
        })
        return
      }
      setState({ file, stage: 'ready', progress: 0, message: null, retryable: false })

      /**
       * The duration check runs in the background rather than gating the control: the
       * header read is usually instantaneous and occasionally never answers, and a
       * "Envoyer" button that waits on it would be a button that sometimes never enables.
       *
       * Guarded on the **file** rather than on the run counter, and the difference is a
       * real upload. A guest who presses "Envoyer" before a slow header read comes back
       * starts a new run, so a run guard would throw the answer away and let an over-long
       * recording go up in full. Keyed on the file, the answer still lands on the
       * recording it describes — and `abandon` below stops the upload it is now refusing,
       * which is the point of knowing.
       */
      void probe(file).then((durationMs) => {
        if (chosen.current !== file) return
        const tooLong = refuseClipDuration(durationMs, limits)
        if (tooLong === null) return
        abandon()
        setState({
          file,
          stage: 'failed',
          progress: 0,
          message: refusalMessage(tooLong, limits, t),
          retryable: false,
        })
      })
    },
    [abandon, limits, probe, t],
  )

  const clear = useCallback(() => {
    abandon()
    chosen.current = null
    setState(IDLE)
  }, [abandon])

  /**
   * Asks the job where it is, until it stops moving.
   *
   * Recursive with a timer rather than an interval, so two polls can never overlap on a
   * connection slow enough that one has not answered before the next is due — which on
   * venue Wi-Fi is the ordinary case, not the corner one.
   */
  const watch = useCallback(
    (clipJobId: string, mine: number, signal: AbortSignal) => {
      const interval = pollIntervalMs ?? POLL_INTERVAL_MS
      const deadline = Date.now() + MAX_WATCH_MS

      const askAgain = (ask: () => Promise<void>): void => {
        if (Date.now() < deadline) {
          poll.current = setTimeout(() => void ask(), interval)
          return
        }
        /**
         * Given up on, out loud.
         *
         * A job the worker never took, or a phone that lost the venue's Wi-Fi for good,
         * would otherwise leave "Traitement de la vidéo…" on the screen and a poll every
         * two seconds for the rest of the evening — a battery cost, and a guest with no
         * way out but a reload. The clip may still arrive; `retryable` says so, and "Vos
         * envois" is where it will turn up.
         */
        setState((previous) => ({
          ...previous,
          stage: 'failed',
          message: t.upload.clipStillWorking,
          // **No retry offered here.** The stated reason for giving up is a box that is
          // still working, and pushing the whole clip at that same box again is the one
          // remedy guaranteed to make it worse. The clip is very likely still coming.
          retryable: false,
        }))
        // One last look, so the sentence above is true at the moment it appears: if the
        // transcode finished in the last two seconds, "Vos envois" now shows it.
        latest.current.onArrived?.()
      }

      const ask = async () => {
        if (run.current !== mine) return
        let job
        try {
          // The same signal the upload used, so unmounting or cancelling stops the poll
          // in flight rather than only discarding what it answers.
          job = await api.clipJob(slug, clipJobId, signal)
        } catch (cause) {
          if (run.current !== mine) return
          if (cause instanceof DOMException && cause.name === 'AbortError') return
          // A poll that could not be answered is not the clip failing: the box is still
          // working on it and the phone's connection came and went. The one refusal that
          // is final is the job having been forgotten entirely.
          if (cause instanceof ApiError && cause.code === 'clipJob.notFound') {
            setState((previous) => ({
              ...previous,
              stage: 'failed',
              message: messageForCode(cause.code, t),
              retryable: true,
            }))
            return
          }
          askAgain(ask)
          return
        }

        if (run.current !== mine) return

        if (job.status === 'done') {
          setState((previous) => ({
            ...previous,
            stage: 'done',
            progress: 100,
            message: t.upload.clipDone,
            retryable: false,
          }))
          latest.current.onArrived?.()
          return
        }

        if (job.status === 'failed') {
          setState((previous) => ({
            ...previous,
            stage: 'failed',
            // The server's stable code, worded here. Every one of them has a sentence —
            // `fr.test.ts` fails otherwise — because a clip that silently stays "en cours
            // de traitement" for the rest of the evening is the failure the status
            // endpoint exists to prevent.
            message: messageForCode(job.failureCode ?? undefined, t),
            // A `failed` row never blocks a re-upload, so sending the same file again
            // always starts a fresh job — but "allowed to" and "worth offering" are
            // different questions, and only the second one belongs on a button.
            retryable: mayAnswerDifferently(job.failureCode),
          }))
          return
        }

        setState((previous) => ({ ...previous, stage: job.status, progress: 100, message: null }))
        askAgain(ask)
      }

      void ask()
    },
    [api, pollIntervalMs, slug, t],
  )

  /**
   * Enters the delay the box asked for, and arms the one timer that leaves it.
   *
   * Shared by the refusal itself and by a `send` that arrives while the delay is still
   * running — a guest who took the recording back and picked another one. Both have to
   * produce the same screen, or the wait is bypassable by doing the obvious thing twice.
   */
  const beginWait = useCallback(
    (seconds: number, mine: number) => {
      blockedUntil.current = Date.now() + seconds * 1_000
      setState((previous) => ({
        ...previous,
        stage: 'waiting',
        progress: 0,
        message: t.upload.clipQueueFullRetry(seconds),
        retryable: false,
      }))
      // Not an automatic retry: the guest chose to send this once, and pushing eighty
      // megabytes again without being asked is their data spent on a guess. What the timer
      // does is give the button back.
      backoff.current = setTimeout(() => {
        backoff.current = null
        if (run.current !== mine) return
        setState((previous) =>
          previous.stage === 'waiting'
            ? { ...previous, stage: 'ready', message: t.upload.clipQueueFreed }
            : previous,
        )
      }, seconds * 1_000)
    },
    [t],
  )

  const send = useCallback(
    (caption: string | null) => {
      const file = state.file
      if (file === null) return
      if (BUSY.includes(state.stage)) return

      abandon()
      const mine = run.current

      // Still inside the delay the box asked for. The recording may well be a different
      // one by now — the wait is about the queue, not about the file — so this is not a
      // second refusal to explain, it is the first one still standing.
      const remaining = blockedUntil.current - Date.now()
      if (remaining > 0) {
        setState({ file, stage: 'ready', progress: 0, message: null, retryable: false })
        beginWait(Math.ceil(remaining / 1_000), mine)
        return
      }

      const aborter = new AbortController()
      controller.current = aborter
      setState({ file, stage: 'uploading', progress: 0, message: null, retryable: false })

      void (async () => {
        try {
          const job = await api.uploadClip(slug, {
            file,
            caption,
            onProgress: (progress) => {
              if (run.current !== mine) return
              setState((previous) => ({ ...previous, progress: progress.percent }))
            },
            signal: aborter.signal,
          })
          if (run.current !== mine) return
          setState((previous) => ({ ...previous, stage: job.status, progress: 100 }))
          if (job.status === 'done') {
            // A repeat of bytes already transcoded. Nothing to watch.
            setState((previous) => ({ ...previous, message: t.upload.clipDone }))
            latest.current.onArrived?.()
            return
          }
          if (job.status === 'failed') {
            setState((previous) => ({
              ...previous,
              message: messageForCode(job.failureCode ?? undefined, t),
              retryable: true,
            }))
            return
          }
          watch(job.clipJobId, mine, aborter.signal)
        } catch (cause) {
          if (run.current !== mine) return
          if (cause instanceof DOMException && cause.name === 'AbortError') return

          if (cause instanceof ApiError && cause.status === 429) {
            // Backpressure, with the box's own estimate of when it clears. `details`
            // rather than the header: the transport does not surface response headers,
            // and `clipQueueFull` puts `retryAfterSeconds` in the error body for exactly
            // this reason.
            const detail = cause.details['retryAfterSeconds']
            const after = typeof detail === 'number' && detail > 0 ? detail : FALLBACK_RETRY_SECONDS
            beginWait(after, mine)
            return
          }

          // A dropped connection. The photo path would hand the bytes to the outbox
          // here; a clip is not queued, so the guest is told that rather than promised a
          // delivery nobody is left to make.
          const networkFault = !(cause instanceof ApiError) || cause.isNetwork
          setState((previous) => ({
            ...previous,
            stage: 'failed',
            progress: 0,
            message: networkFault
              ? t.upload.clipNotQueued
              : cause instanceof ApiError
                ? messageForCode(cause.code, t)
                : t.errors.unknown,
            /**
             * A dropped connection is worth another press. A refusal on the merits is
             * not — the same bytes fail the same way — except a `429`, handled above.
             *
             * `mayAnswerDifferently` is consulted **as well as** the status, because a
             * status alone gets one case badly wrong: `500 clip.transcoderUnavailable`
             * is not a client fault and so reads as retryable, while what it actually
             * means is that this box has no encoder and will not have one until somebody
             * redeploys. Every offered retry there is another full upload.
             */
            retryable:
              mayAnswerDifferently(cause instanceof ApiError ? cause.code : null) &&
              (networkFault || !(cause instanceof ApiError) || !cause.isClientFault),
          }))
        }
        // **No `finally` clearing the controller**, deliberately. The upload settling is
        // not the end of the run: the poll that follows it shares this signal, so
        // dropping the reference here would leave `abandon` — and therefore unmount and
        // cancel — with nothing to abort, and a `GET` in flight against a screen that is
        // gone. It is released by `abandon` itself, which is the only thing that ends a
        // run.
      })()
    },
    [abandon, api, beginWait, slug, state.file, state.stage, t, watch],
  )

  const cancel = useCallback(() => {
    abandon()
    setState((previous) => ({
      ...previous,
      stage: previous.file === null ? 'idle' : 'ready',
      progress: 0,
      message: null,
      retryable: false,
    }))
  }, [abandon])

  return { ...state, choose, clear, send, cancel }
}
