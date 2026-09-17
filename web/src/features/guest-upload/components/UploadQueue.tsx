import { Badge } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { CloseIcon } from '../../../design-system/components/CloseIcon'
import { IconButton } from '../../../design-system/components/IconButton'
import { Progress } from '../../../design-system/components/Progress'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { UiText } from '../../../lib/i18n/translations'
import type { StatusTone } from '../../../design-system/components/StatusIcon'
import type { UploadItem, UploadItemState } from '../hooks/useUploadQueue'
import styles from './UploadQueue.module.css'

/**
 * One row per photo on its way up.
 *
 * The whole list is a single `aria-live="polite"` region carrying a summary. A live
 * region per row would turn a thirty-photo upload into a screen-reader monologue that
 * cannot be interrupted, and the guest only needs one fact: how many have arrived.
 *
 * `data-testid="upload-item-<n>"` with `data-state` is the contract the Playwright
 * suite reads. The index is positional, which is why a photo that has arrived leaves
 * the queue rather than sitting at index 0 forever.
 */

const labelsFor = (t: UiText): Readonly<Record<UploadItemState, string>> => ({
  pending: t.upload.itemPending,
  preparing: t.upload.itemPreparing,
  uploading: t.upload.itemUploading,
  done: t.upload.itemDone,
  duplicate: t.upload.itemDuplicate,
  queued: t.upload.itemQueued,
  failed: t.upload.itemFailed,
})

/**
 * Colour is never the only signal: `Badge` pairs each tone with its own glyph and the
 * word above, so the states are distinguishable in sunlight and to a colourblind
 * guest.
 *
 * `duplicate` is deliberately not `danger`. "Already sent" is reassurance — the photo
 * is in the event — and 1.0 reported it as an error, so guests sent it a third time.
 *
 * `queued` is `warning` for the same reason in reverse: it is not a failure and must
 * not be dressed as one, but it is the one state where something is still owed, and the
 * bang glyph says "not finished" where the info dot would say "nothing to do".
 */
const TONES: Record<UploadItemState, StatusTone> = {
  pending: 'neutral',
  preparing: 'neutral',
  uploading: 'accent',
  done: 'success',
  duplicate: 'accent',
  queued: 'warning',
  failed: 'danger',
}

const SETTLED: readonly UploadItemState[] = ['done', 'duplicate']

export interface UploadQueueProps {
  readonly items: readonly UploadItem[]
  readonly onRetry: (id: string) => void
  readonly onRemove: (id: string) => void
}

const summaryFor = (items: readonly UploadItem[], t: UiText): string => {
  if (items.length === 0) return t.upload.queueEmpty

  const arrived = items.filter((item) => SETTLED.includes(item.state)).length
  if (arrived === items.length) return t.upload.thanks

  const failed = items.filter((item) => item.state === 'failed').length
  const progress = t.upload.queueSummary(arrived, items.length)
  return failed === 0 ? progress : `${progress} ${t.upload.queueFailed(failed)}`
}

export function UploadQueue({ items, onRetry, onRemove }: UploadQueueProps) {
  const t = useTranslations()
  const labels = labelsFor(t)

  return (
    <section className={styles['queue']} aria-label={t.upload.queueLabel}>
      {/* Rendered even when empty: a live region has to exist before its content
          changes, or the first announcement is swallowed. */}
      <p className={styles['summary']} aria-live="polite">
        {summaryFor(items, t)}
      </p>

      {items.length === 0 ? null : (
        <ul className={styles['list']}>
          {items.map((item, index) => {
            const position = index + 1
            return (
              <li
                key={item.id}
                className={styles['item']}
                data-testid={`upload-item-${index}`}
                data-state={item.state}
              >
                {/* The alt is the photo's position, never its filename: 1.0 used the
                    filename and it read aloud as "IMG_4821.jpg". */}
                <img
                  className={styles['thumb']}
                  src={item.previewUrl}
                  alt={t.upload.itemAlt(position)}
                />

                <div className={styles['detail']}>
                  <Badge tone={TONES[item.state]}>{labels[item.state]}</Badge>
                  {item.state === 'uploading' ? (
                    <Progress value={item.progress} label={t.upload.itemProgress(position)} />
                  ) : null}
                  {item.error === null ? null : <p className={styles['error']}>{item.error}</p>}
                </div>

                <div className={styles['controls']}>
                  {/* Offered only for a failure another attempt could fix. A refused
                      format fails identically, and a button that cannot work is worse
                      than no button. */}
                  {item.state === 'failed' && item.retryable ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={t.upload.retryItem(position)}
                      onClick={() => onRetry(item.id)}
                    >
                      {t.app.retry}
                    </Button>
                  ) : null}
                  <IconButton
                    aria-label={t.upload.removeItem(position)}
                    icon={<CloseIcon />}
                    onClick={() => onRemove(item.id)}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
