import { useId, useState } from 'react'
import { Badge } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { CloseIcon } from '../../../design-system/components/CloseIcon'
import { IconButton } from '../../../design-system/components/IconButton'
import { Notice } from '../../../design-system/components/Notice'
import { Progress } from '../../../design-system/components/Progress'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { UiText } from '../../../lib/i18n/translations'
import type { StatusTone } from '../../../design-system/components/StatusIcon'
import type { BatchSummary } from '../hooks/queueBatch'
import type { UploadItem, UploadItemState } from '../hooks/useUploadQueue'
import styles from './UploadQueue.module.css'

/**
 * One row per photo on its way up.
 *
 * While anything is still on its way, or has failed, every row is shown. Once the whole batch
 * has arrived (`batch.settledOk`) the rows fold into one line, "7 photos envoyées", with the
 * way to the guest's list and a "Détails" disclosure that brings the rows back. A guest with ten
 * rows of "Envoyée" never saw that their photos had moved to "Vos envois" above, which is where
 * the answer to "did it work?" actually is. The rows are folded with `hidden`, not removed:
 * `upload-item-<n>` and `data-state` stay in the page, and a folded row is out of the
 * accessibility tree. A failure never folds: its "Réessayer" is the only way out of it.
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

export interface UploadQueueProps {
  readonly items: readonly UploadItem[]
  /** Whether the batch is finished and how it went: `summarizeBatch`, computed by the queue. */
  readonly batch: BatchSummary
  readonly onRetry: (id: string) => void
  readonly onRemove: (id: string) => void
  /** The × of the summary line: drops the rows that have arrived. */
  readonly onDismiss: () => void
  /**
   * Takes the guest to "Vos envois". Absent when there is no such list on the screen (the
   * gallery is no longer served), and the button is then not offered.
   */
  readonly onViewMine?: (() => void) | undefined
}

/** The sentence the live region carries while the batch is not finished. */
const progressFor = (items: readonly UploadItem[], batch: BatchSummary, t: UiText): string => {
  if (items.length === 0) return t.upload.queueEmpty

  const failed = items.filter((item) => item.state === 'failed').length
  const progress = t.upload.queueSummary(batch.arrived, items.length)
  return failed === 0 ? progress : `${progress} ${t.upload.queueFailed(failed)}`
}

export function UploadQueue({
  items,
  batch,
  onRetry,
  onRemove,
  onDismiss,
  onViewMine,
}: UploadQueueProps) {
  const t = useTranslations()
  const labels = labelsFor(t)
  const listId = useId()

  /**
   * Whether the guest asked for the rows back, for the batch on screen. It lasts only while the
   * batch stays finished: a new batch (or a failure) puts the rows back anyway, and when it
   * finishes again it is folded again rather than inheriting a choice made about the last one.
   * Reset while rendering, from the previous value, so no frame shows the stale choice.
   */
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [wasSettled, setWasSettled] = useState(batch.settledOk)
  if (wasSettled !== batch.settledOk) {
    setWasSettled(batch.settledOk)
    if (!batch.settledOk) setDetailsOpen(false)
  }
  const folded = batch.settledOk && !detailsOpen

  return (
    <section className={styles['queue']} aria-label={t.upload.queueLabel}>
      <div className={styles['head']}>
        {/* Rendered even when empty: a live region has to exist before its content
            changes, or the first announcement is swallowed. The summary line is this very
            region, so it is announced once, when the batch finishes, and again only if its
            words change. The buttons beside it are outside it: a live region that held
            buttons would read them out. */}
        <div className={styles['live']} aria-live="polite">
          {batch.settledOk ? (
            <Notice tone="success" variant="inline">
              {t.upload.queueDone(batch.arrived, batch.alreadyThere)}
            </Notice>
          ) : (
            <p className={styles['summary']}>{progressFor(items, batch, t)}</p>
          )}
        </div>

        {batch.settledOk ? (
          <div className={styles['actions']}>
            {onViewMine === undefined ? null : (
              <Button size="sm" variant="secondary" onClick={onViewMine}>
                <span aria-hidden="true">↑</span>
                {t.upload.queueViewMine}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={detailsOpen}
              aria-controls={listId}
              onClick={() => setDetailsOpen((open) => !open)}
            >
              {t.upload.queueDetails}
            </Button>
            <IconButton
              aria-label={t.upload.queueDismiss}
              icon={<CloseIcon />}
              onClick={onDismiss}
            />
          </div>
        ) : null}
      </div>

      {items.length === 0 ? null : (
        <ul id={listId} className={styles['list']} hidden={folded}>
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
