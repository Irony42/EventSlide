import { useTranslations } from '../../../lib/i18n/useTranslations'
import { useSwipeDecision } from '../hooks/useSwipeDecision'
import type { SwipeIntent } from '../swipe/swipeGesture'
import type { GuestbookQueueItemDto } from '../../../lib/api/dto'
import cardStyles from './SwipeCard.module.css'
import styles from './MessageSwipeCard.module.css'

/**
 * A guestbook message in the swipeable card (spec 15): the same gesture as a photo, the same
 * sides (right publishes, left refuses), the same real buttons underneath on the page.
 *
 * It shares the card's look and the gesture hook with `SwipeCard` and leaves the clip
 * playback of that component alone. The text scrolls vertically inside the card: the card
 * is `touch-action: pan-y`, so a vertical drag is the browser's and decides nothing, and
 * only a horizontal one reaches the gesture.
 */
export interface MessageSwipeCardProps {
  readonly message: GuestbookQueueItemDto
  readonly onDecide: (decision: SwipeIntent, entryId: string) => void
  readonly disabled?: boolean
}

export function MessageSwipeCard({ message, onDecide, disabled = false }: MessageSwipeCardProps) {
  const t = useTranslations()
  const swipe = useSwipeDecision({
    onDecide: (decision) => onDecide(decision, message.id),
    disabled,
  })
  const author = message.authorName ?? t.guestbookHost.anonymous

  const hint =
    swipe.intent === null
      ? null
      : swipe.intent === 'publish'
        ? swipe.committed
          ? t.mobileModeration.releaseToPublish
          : t.moderation.publish
        : swipe.committed
          ? t.mobileModeration.releaseToReject
          : t.moderation.reject

  return (
    <article
      data-testid="mobile-moderation-card"
      data-intent={swipe.intent ?? 'none'}
      data-committed={swipe.committed ? 'true' : 'false'}
      data-dragging={swipe.dragging ? 'true' : 'false'}
      className={cardStyles['card']}
      style={{ transform: `translateX(${swipe.offset}px)` }}
      aria-label={t.moderation.messageOf(author)}
      onPointerDown={swipe.onPointerDown}
    >
      {/* Guest content: whole, as text, in the language it was written in. */}
      <p className={styles['text']} translate="no">
        {message.text}
      </p>
      <div className={cardStyles['meta']}>
        <p
          className={cardStyles['author']}
          translate={message.authorName === null ? undefined : 'no'}
        >
          {author}
        </p>
      </div>
      {hint === null ? null : (
        <p
          className={cardStyles['hint']}
          aria-hidden="true"
          style={{ opacity: 0.45 + 0.55 * swipe.progress }}
        >
          {hint}
        </p>
      )}
    </article>
  )
}
