import { forwardRef } from 'react'
import { Button } from '../../../design-system/components/Button'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { UploadItem } from '../hooks/useUploadQueue'
import styles from './FoldedBar.module.css'

/**
 * The upload pane folded: one bar at the bottom of the screen, always there.
 *
 * Folding is not cancelling. The bar says what the pane holds: a big "Envoyer une photo" when
 * nothing is chosen, and when photos are chosen but not sent their thumbnails (at most three,
 * stacked) with a badge carrying the count, beside "Envoyer N" so the guest can send without
 * reopening. A tap on the thumbnails, or on "Envoyer une photo", reopens the pane; the selection
 * lives in the page's queue and was never touched. Removing a photo stays the cross on its row,
 * in the open pane.
 *
 * One `aria-live` region, here, because the queue's own lives in the folded content and a hidden
 * live region announces nothing: it says how a send from this bar is going.
 */

/** How many thumbnails are stacked; the badge says how many photos there really are. */
const STACKED = 3

export interface FoldedBarProps {
  /** Every row of the queue; the bar draws the ones still waiting to be sent. */
  readonly items: readonly UploadItem[]
  readonly sendableCount: number
  readonly sending: boolean
  /** The state of a send, in words (spoken, and shown when nothing is waiting). Empty: nothing to say. */
  readonly status: string
  /** `id` of the folded content, for `aria-controls`. */
  readonly controls: string
  readonly onOpen: () => void
  readonly onSend: () => void
}

export const FoldedBar = forwardRef<HTMLButtonElement, FoldedBarProps>(function FoldedBar(
  { items, sendableCount, sending, status, controls, onOpen, onSend },
  openRef,
) {
  const t = useTranslations()
  const waiting = items.filter((item) => item.state === 'pending')

  return (
    <div className={styles['bar']} data-testid="folded-bar">
      <div className={styles['status']} role="status">
        {status === '' || waiting.length > 0 ? null : <span>{status}</span>}
      </div>
      {waiting.length === 0 ? (
        <Button
          ref={openRef}
          variant="primary"
          size="lg"
          block
          aria-expanded={false}
          aria-controls={controls}
          onClick={onOpen}
        >
          <span aria-hidden="true">+</span>
          {t.upload.openPane}
        </Button>
      ) : (
        <>
          <button
            ref={openRef}
            type="button"
            className={styles['stack']}
            aria-expanded={false}
            aria-controls={controls}
            aria-label={t.upload.openPaneReady(waiting.length)}
            onClick={onOpen}
          >
            {waiting.slice(0, STACKED).map((item) => (
              <img key={item.id} className={styles['thumb']} src={item.previewUrl} alt="" />
            ))}
            <span className={styles['badge']} data-testid="folded-badge">
              {waiting.length}
            </span>
          </button>
          <Button variant="primary" size="lg" block loading={sending} onClick={onSend}>
            {t.upload.sendCount(sendableCount)}
          </Button>
        </>
      )}
    </div>
  )
})
