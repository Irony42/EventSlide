import { useId, type ChangeEvent } from 'react'
import { Button } from '../../../design-system/components/Button'
import { Progress } from '../../../design-system/components/Progress'
import { StatusIcon } from '../../../design-system/components/StatusIcon'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { UiText } from '../../../lib/i18n/translations'
import { megabytes, type ClipLimits } from '../clipFile'
import type { ClipStage, ClipUpload } from '../hooks/useClipUpload'
import styles from './ClipComposer.module.css'

/**
 * The video half of the composer: pick one, watch it go, find out what became of it.
 *
 * It sits beside the photo picker rather than inside it, and the separation is the
 * product decision. A clip is not "a heavier photo": the guest sends exactly one, it is
 * refused for reasons a photo is not, it takes a minute of venue Wi-Fi and then another
 * of transcoding, and none of that belongs in a queue whose whole shape is "several small
 * things at once". Folding video into `useUploadQueue` would have put a state machine
 * with six server-side states into rows that share one progress bar.
 *
 * Rendered only when the event allows clips. The host's switch reads `false` on every
 * gallery created before video shipped, and offering a control that answers
 * `403 event.clipsNotAllowed` after eighty megabytes is exactly the failure this whole
 * surface is arranged to avoid.
 */

export interface ClipComposerProps {
  readonly clip: ClipUpload
  readonly limits: ClipLimits
  /** The batch caption, so a guest who wrote one does not lose it on the video. */
  readonly caption: string | null
}

/** What the screen says at each stage. `null` where the surface says it another way. */
const stageLabelsFor = (t: UiText): Readonly<Record<ClipStage, string | null>> => ({
  idle: null,
  ready: t.upload.clipChosen,
  uploading: t.upload.clipUploading,
  // The server's own three, said as the guest experiences them. `reserved` is a window
  // of milliseconds nobody normally sees, and it means the same thing to them as the
  // wait that follows it.
  reserved: t.upload.clipQueued,
  queued: t.upload.clipQueued,
  running: t.upload.clipRunning,
  done: null,
  // Both carry their own sentence in `clip.message`; a second line above it would say
  // the same thing twice on a 360 px screen.
  waiting: null,
  failed: null,
})

/**
 * Stages during which nothing may be sent.
 *
 * `waiting` is in here for a reason that is not obvious: the box refused with a
 * `Retry-After`, and **the bytes travelled before the refusal** — the upload is written
 * to disk and only then is the queue depth decided. A send button offered during the wait
 * is eighty megabytes of a guest's evening spent to be told the same thing again.
 */
const BUSY: readonly ClipStage[] = ['uploading', 'reserved', 'queued', 'running', 'waiting']

/**
 * The stages where the bytes are already on the box and nothing can be taken back.
 *
 * "Annuler l'envoi" is offered during `uploading` and nowhere else, because that is the
 * only stage where it is true: the `XMLHttpRequest` is aborted and the box never sees the
 * file. Once the `202` is back the job exists, and this surface has no way to withdraw it
 * — which is a property of the spine rather than a missing button:
 *
 * - The transcode queue deduplicates **per event**, so two guests who forward the same
 *   video from the group chat are handed one job. Cancelling it would delete somebody
 *   else's clip, which is the exact class of defect the spine's review rounds were about.
 * - `queued` may only become `running`; there is no transition a cancellation could take.
 * - No route lets a guest touch a job at all — `POST` and `GET` are the whole surface.
 *
 * So the screen says what happens next instead. The guest's real remedy is the one the
 * product already gives them: the clip arrives in "Vos envois" like any other upload, and
 * a host decides about it — a moderator is the backstop here, and they are a better one
 * than a cancel button that races a worker.
 */
const ON_THE_BOX: readonly ClipStage[] = ['reserved', 'queued', 'running']

/** Which tone the message carries. A wait is not a failure and must not read as one. */
const TONE: Readonly<Record<ClipStage, 'danger' | 'warning' | 'success' | null>> = {
  idle: null,
  ready: null,
  uploading: null,
  reserved: null,
  queued: null,
  running: null,
  done: 'success',
  waiting: 'warning',
  failed: 'danger',
}

export function ClipComposer({ clip, limits, caption }: ClipComposerProps) {
  const t = useTranslations()
  const stageLabel = stageLabelsFor(t)
  const libraryId = useId()
  const cameraId = useId()

  const handle = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Cleared, so picking the same recording again still fires a change event —
    // otherwise a guest who cancelled by mistake cannot re-select it.
    event.target.value = ''
    if (file !== undefined) clip.choose(file)
  }

  const busy = BUSY.includes(clip.stage)
  const label = stageLabel[clip.stage]
  const tone = TONE[clip.stage]

  return (
    <section className={styles['composer']} aria-labelledby={`${libraryId}-heading`}>
      {/* Named "Vidéo" rather than "Ajouter une vidéo": the section's accessible name
          and the picker's label would otherwise be the same string, so a screen reader
          announces the heading and the control it contains identically. */}
      <h2 className={styles['heading']} id={`${libraryId}-heading`}>
        {t.upload.clipSection}
      </h2>

      {/* The limits, before the picker opens. A guest who reads "15 secondes, 80 Mo"
          films a shorter sequence; a guest who does not reads it as a refusal later. */}
      <p className={styles['hint']}>
        {t.upload.clipHint(limits.maxSeconds, megabytes(limits.maxBytes))}
      </p>

      <div className={styles['picker']}>
        {/* Both are real `<input type="file">`, left in the tab order and made
            transparent over their label — the pattern `PhotoPicker` documents. A
            `<div onClick>` calling `input.click()` is unreachable by keyboard. */}
        <label className={styles['action']} htmlFor={libraryId}>
          <span>{clip.file === null ? t.upload.addClip : t.upload.clipChange}</span>
          <input
            id={libraryId}
            className={styles['input']}
            data-testid="clip-input"
            type="file"
            accept="video/*"
            disabled={busy}
            onChange={handle}
          />
        </label>

        <label className={styles['action']} htmlFor={cameraId}>
          <span>{t.upload.recordClip}</span>
          {/* `capture="environment"` keeps the recording inside the page. Without it the
              guest leaves for the camera app, comes back to a reloaded page, and the
              queue behind them is gone. */}
          <input
            id={cameraId}
            className={styles['input']}
            type="file"
            accept="video/*"
            capture="environment"
            disabled={busy}
            onChange={handle}
          />
        </label>
      </div>

      {clip.file === null ? null : (
        <div className={styles['chosen']} data-testid="clip-state" data-stage={clip.stage}>
          <p className={styles['name']}>{clip.file.name}</p>
          <p className={styles['size']}>{t.upload.clipSize(megabytes(clip.file.size))}</p>

          {/*
            One live region for the whole flow, so the four states are announced in turn
            rather than each one shouting over the last. A guest who cannot see the
            screen has no other way to know a clip moved from "envoi" to "traitement",
            and the gap between them is where they would otherwise send it again.
          */}
          <p className={styles['stage']} role="status">
            {label ?? ''}
          </p>

          {clip.stage === 'uploading' ? (
            <Progress value={clip.progress} label={t.upload.clipProgress} showValue />
          ) : null}

          {clip.message === null || tone === null ? null : (
            <p
              className={styles[tone]}
              // `alert` interrupts, and only a refusal earns that. A wait and a success
              // are announced in turn with everything else the region is saying.
              role={tone === 'danger' ? 'alert' : 'status'}
            >
              <StatusIcon tone={tone} />
              {clip.message}
            </p>
          )}

          {/*
            One offer per state, and never a disabled one.

            Three states offer only "choisir une autre vidéo", for three different
            reasons that come to the same move. A clip that arrived is finished with. A
            refusal the same bytes would meet again — too long, too heavy, the host has
            video off — cannot be retried, and a greyed-out "Réessayer" beside it is a
            control that exists to be refused, which a guest in a dark room reads as the
            app being broken. And a full queue must not offer this recording back
            immediately: the bytes travel before that refusal, so an instant retry is
            eighty megabytes of their evening spent to be told the same thing.
          */}
          <div className={styles['actions']}>
            {ON_THE_BOX.includes(clip.stage) ? (
              /* Nothing to offer, and saying so. A button here would promise a
                 withdrawal this surface cannot perform — see `ON_THE_BOX`. */
              <p className={styles['notice']}>{t.upload.clipAlreadySent}</p>
            ) : clip.stage === 'done' ||
              clip.stage === 'waiting' ||
              (clip.stage === 'failed' && !clip.retryable) ? (
              <Button variant="secondary" block onClick={clip.clear}>
                {t.upload.clipDiscard}
              </Button>
            ) : busy ? (
              <Button variant="ghost" block onClick={clip.cancel}>
                {t.upload.clipCancel}
              </Button>
            ) : (
              <>
                <Button variant="primary" size="lg" block onClick={() => clip.send(caption)}>
                  {clip.stage === 'failed' ? t.app.retry : t.upload.clipSend}
                </Button>
                <Button variant="ghost" block onClick={clip.clear}>
                  {t.app.cancel}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
