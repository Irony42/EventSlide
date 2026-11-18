import { EmptyState } from '../../../design-system/components/EmptyState'
import type { RevealDto } from '../../../lib/api/dto'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { useRevealWhen } from '../../../lib/useRevealWhen'
import styles from './FeedWait.module.css'

export interface FeedWaitProps {
  readonly reveal: RevealDto
  /** The server's clock less this phone's, measured at the wall's read. */
  readonly offsetMs: number
}

/**
 * What the evening's feed says while a disposable-camera evening is held (spec 23): when the photos
 * open, and the time left. The list is empty by the server's rule (the wall serves nothing before
 * the reveal), so this is not an error and not "nothing yet": it says what will happen. The countdown
 * is counted on the server's clock and is not a live region, which a minute-by-minute readout would
 * turn into noise; the guest's own photographs are announced on the upload screen when they develop.
 */
export function FeedWait({ reveal, offsetMs }: FeedWaitProps) {
  const text = useTranslations()
  const when = useRevealWhen(reveal, offsetMs)
  const title =
    when.atMs === null
      ? text.reveal.feedSoon
      : when.today
        ? text.reveal.feedAt(when.time)
        : text.reveal.feedOn(when.dateTime)
  const left =
    when.atMs === null
      ? null
      : when.left === 'soon' || when.left === null
        ? text.reveal.guestSoon
        : text.reveal.guestLeft(when.left.hours, when.left.minutes)
  return (
    <EmptyState as="h2" title={title} description={text.reveal.feedHint} data-testid="feed-reveal">
      {left === null ? null : (
        <p className={styles['left']} data-testid="feed-reveal-left">
          {left}
        </p>
      )}
    </EmptyState>
  )
}
