import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Button } from '../../../design-system/components/Button'
import { Field } from '../../../design-system/components/Field'
import { Notice } from '../../../design-system/components/Notice'
import { Textarea } from '../../../design-system/components/Textarea'
import { VisuallyHidden } from '../../../design-system/components/VisuallyHidden'
import { characterCount, clampCharacters } from '../../../lib/characters'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { useVoiceRecorder } from '../hooks/useVoiceRecorder'
import { MAX_VOICE_SECONDS, VOICE_CAPTION_MAX, formatClock } from '../voiceRecording'
import type { VoiceSendResult } from '../hooks/useVoiceOutbox'
import type { VoiceFailure, VoiceRecording } from '../hooks/useVoiceRecorder'
import styles from './VoiceComposer.module.css'

/**
 * Recording a voice message, listening to it and sending it (spec 25, section 3).
 *
 * One control while recording (a round 56 px button, labelled, never colour alone), a clock in
 * text taken from the phone's own timer, and a level that does not move under
 * `prefers-reduced-motion`. When it stops, the guest **listens before sending**, to a local copy
 * that never leaves the phone until "Envoyer": a preview that cannot be played here does not stop
 * the send. The text is always one press away ("Écrire un mot à la place"): the voice is a plus,
 * never the only door of the guestbook.
 *
 * **No rule lives here.** How long a message may be, how many a guest may leave and whether the
 * event takes one are the server's answers; what the screen announces is said once, politely, at the
 * start, at ten seconds from the end and at the stop, never second by second.
 */

export interface VoiceComposerProps {
  /** Sends the recording (writing it to the phone first); resolves to what became of it. */
  readonly onSend: (recording: VoiceRecording, caption: string | null) => Promise<VoiceSendResult>
  /** The recording is on its way or kept: the card closes this and says so. */
  readonly onResult: (result: Exclude<VoiceSendResult, { kind: 'failed' }>) => void
  readonly onClose: () => void
  readonly onWriteInstead: () => void
}

const MAX_MS = MAX_VOICE_SECONDS * 1_000

export function VoiceComposer({ onSend, onResult, onClose, onWriteInstead }: VoiceComposerProps) {
  const t = useTranslations()
  const copy = t.guestbookVoice
  const recorder = useVoiceRecorder()
  const { phase, recording, failure } = recorder
  const [sending, setSending] = useState(false)
  const recordButton = useRef<HTMLButtonElement | null>(null)

  // Focus follows the screen: arriving here lands on the record button, and a recording thrown away
  // or refused hands it back (the stop hands it to "Écouter", in the preview).
  const wasRecording = useRef(false)
  useEffect(() => {
    if (phase === 'idle' && wasRecording.current) recordButton.current?.focus()
    wasRecording.current = phase === 'recording'
  }, [phase])
  useEffect(() => {
    recordButton.current?.focus()
  }, [])

  const failureSentence = (reason: VoiceFailure): string => {
    switch (reason) {
      case 'denied':
        return copy.micBlocked
      case 'blockedByPolicy':
        return copy.micUnavailableHere
      case 'unavailable':
        return copy.micMissing
      case 'tooShort':
        return copy.tooShort
    }
  }

  // Said once at each of three moments, in a region that is mounted from the start.
  const announcement =
    phase === 'recording'
      ? recorder.nearEnd
        ? copy.nearEnd
        : copy.recordingAnnounce
      : phase === 'recorded' && recording !== null
        ? copy.recordedAnnounce(formatClock(recording.durationMs))
        : ''

  const recordingNow = phase === 'recording'

  return (
    <div className={styles['composer']}>
      <VisuallyHidden>
        <span role="status" data-testid="voice-announcement">
          {announcement}
        </span>
      </VisuallyHidden>

      {failure === null ? null : (
        <Notice tone="danger" variant="boxed" role="alert">
          {failureSentence(failure)}
        </Notice>
      )}

      {phase === 'recorded' && recording !== null ? (
        // Keyed by the take: "Recommencer" and a new recording start from a clean preview.
        <RecordedPreview
          key={`${recording.blob.size}:${recording.durationMs}`}
          recording={recording}
          onRestart={recorder.reset}
          onSend={onSend}
          onResult={onResult}
          onBusy={setSending}
        />
      ) : (
        <>
          <div className={styles['recordRow']}>
            <button
              ref={recordButton}
              type="button"
              className={styles['record']}
              data-recording={recordingNow ? '' : undefined}
              disabled={phase === 'requesting'}
              onClick={() => (recordingNow ? recorder.stop() : void recorder.start())}
            >
              {recordingNow ? copy.stop : copy.record}
            </button>
            {recordingNow ? (
              <p className={styles['clock']} data-near={recorder.nearEnd ? '' : undefined}>
                {copy.clock(formatClock(recorder.elapsedMs), formatClock(MAX_MS))}
              </p>
            ) : null}
          </div>
          {recordingNow ? (
            <>
              <div className={styles['meter']} aria-hidden="true">
                <span
                  className={styles['bar']}
                  style={{ '--level': recorder.level } as CSSProperties}
                />
              </div>
              <p className={styles['hint']}>{copy.closeToTheMicrophone}</p>
            </>
          ) : null}
        </>
      )}

      <div className={styles['actions']}>
        <Button variant="ghost" size="sm" className={styles['link']} onClick={onWriteInstead}>
          {copy.writeInstead}
        </Button>
        <Button variant="ghost" size="sm" disabled={sending || recordingNow} onClick={onClose}>
          {copy.cancel}
        </Button>
      </div>
    </div>
  )
}

interface RecordedPreviewProps {
  readonly recording: VoiceRecording
  readonly onRestart: () => void
  readonly onSend: VoiceComposerProps['onSend']
  readonly onResult: VoiceComposerProps['onResult']
  readonly onBusy: (busy: boolean) => void
}

/**
 * What the guest does with a take: listens to it, adds a line, sends it or starts over.
 *
 * The local copy is an object URL handed to an `<audio>` element imperatively, and released with
 * the recording: nothing about it is React state. A preview that cannot be played (a fragmented MP4
 * on iOS is not always readable by an `<audio>`) is said in a sentence and **never blocks the send**.
 */
function RecordedPreview({ recording, onRestart, onSend, onResult, onBusy }: RecordedPreviewProps) {
  const t = useTranslations()
  const copy = t.guestbookVoice
  const [caption, setCaption] = useState('')
  const [sending, setSending] = useState(false)
  const [notKept, setNotKept] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [playing, setPlaying] = useState(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  const listenButton = useRef<HTMLButtonElement | null>(null)
  const canPreview = typeof URL.createObjectURL === 'function'

  useEffect(() => {
    const player = audio.current
    if (player === null || !canPreview) return
    const url = URL.createObjectURL(recording.blob)
    player.src = url
    return () => {
      player.removeAttribute('src')
      URL.revokeObjectURL(url)
    }
  }, [recording, canPreview])

  // The stop handed focus here: the next thing a guest does is listen.
  useEffect(() => {
    listenButton.current?.focus()
  }, [])

  const listen = () => {
    const player = audio.current
    if (player === null) return
    if (playing) {
      player.pause()
      setPlaying(false)
      return
    }
    setPlaying(true)
    // A rejected play (an MP4 Safari will not decode) is the failed preview, not a failed send.
    void Promise.resolve(player.play()).catch(() => {
      setPlaying(false)
      setPreviewFailed(true)
    })
  }

  const send = async () => {
    if (sending) return
    setSending(true)
    onBusy(true)
    setNotKept(false)
    try {
      const result = await onSend(recording, caption.trim() === '' ? null : caption.trim())
      if (result.kind === 'failed') setNotKept(true)
      else onResult(result)
    } finally {
      setSending(false)
      onBusy(false)
    }
  }

  return (
    <div className={styles['preview']}>
      {recording.interrupted ? (
        <Notice tone="warning" variant="boxed" role="status">
          {copy.interrupted(formatClock(recording.durationMs))}
        </Notice>
      ) : null}
      <p className={styles['clock']}>{formatClock(recording.durationMs)}</p>
      <audio
        ref={audio}
        preload="auto"
        onEnded={() => setPlaying(false)}
        onError={() => setPreviewFailed(true)}
      />
      {previewFailed || !canPreview ? <p className={styles['hint']}>{copy.previewFailed}</p> : null}
      <div className={styles['actions']}>
        <Button
          ref={listenButton}
          variant="secondary"
          size="lg"
          disabled={previewFailed || !canPreview}
          onClick={listen}
        >
          {playing ? copy.listenPause : copy.listen}
        </Button>
        <Button variant="ghost" size="lg" disabled={sending} onClick={onRestart}>
          {copy.restart}
        </Button>
      </div>
      <Field
        label={copy.captionLabel}
        hint={
          caption === ''
            ? t.upload.captionHint(VOICE_CAPTION_MAX)
            : t.upload.captionRemaining(VOICE_CAPTION_MAX - characterCount(caption))
        }
        optional
      >
        {(control) => (
          <Textarea
            {...control}
            value={caption}
            translate="no"
            onChange={(event) => setCaption(clampCharacters(event.target.value, VOICE_CAPTION_MAX))}
          />
        )}
      </Field>
      {notKept ? (
        <Notice tone="danger" variant="boxed" role="alert">
          {copy.notKept}
        </Notice>
      ) : null}
      <Button variant="primary" size="lg" block loading={sending} onClick={() => void send()}>
        {copy.send}
      </Button>
    </div>
  )
}
