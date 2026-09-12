import { Badge } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { CloseIcon } from '../../../design-system/components/CloseIcon'
import { IconButton } from '../../../design-system/components/IconButton'
import { Progress } from '../../../design-system/components/Progress'
import { fr } from '../../../lib/i18n/fr'
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

const LABELS: Record<UploadItemState, string> = {
  pending: fr.upload.itemPending,
  preparing: fr.upload.itemPreparing,
  uploading: fr.upload.itemUploading,
  done: fr.upload.itemDone,
  duplicate: fr.upload.itemDuplicate,
  queued: fr.upload.itemQueued,
  failed: fr.upload.itemFailed,
}

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

const summaryFor = (items: readonly UploadItem[]): string => {
  if (items.length === 0) return fr.upload.queueEmpty

  const arrived = items.filter((item) => SETTLED.includes(item.state)).length
  if (arrived === items.length) return fr.upload.thanks

  const failed = items.filter((item) => item.state === 'failed').length
  const progress = fr.upload.queueSummary(arrived, items.length)
  return failed === 0 ? progress : `${progress} ${fr.upload.queueFailed(failed)}`
}

export function UploadQueue({ items, onRetry, onRemove }: UploadQueueProps) {
  return (
    <section className={styles['queue']} aria-label={fr.upload.queueLabel}>
      {/* Rendered even when empty: a live region has to exist before its content
          changes, or the first announcement is swallowed. */}
      <p className={styles['summary']} aria-live="polite">
        {summaryFor(items)}
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
                  alt={fr.upload.itemAlt(position)}
                />

                <div className={styles['detail']}>
                  <Badge tone={TONES[item.state]}>{LABELS[item.state]}</Badge>
                  {item.state === 'uploading' ? (
                    <Progress value={item.progress} label={fr.upload.itemProgress(position)} />
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
                      aria-label={fr.upload.retryItem(position)}
                      onClick={() => onRetry(item.id)}
                    >
                      {fr.app.retry}
                    </Button>
                  ) : null}
                  <IconButton
                    aria-label={fr.upload.removeItem(position)}
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
