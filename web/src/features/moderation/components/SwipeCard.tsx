import { fr } from '../../../lib/i18n/fr'
import { useSwipeDecision } from '../hooks/useSwipeDecision'
import type { SwipeIntent } from '../swipe/swipeGesture'
import type { ModerationPhotoDto } from '../../../lib/api/dto'
import styles from './SwipeCard.module.css'

/**
 * The one photo the host is judging, and the surface their thumb drags.
 *
 * Not a button, and nothing inside it is: a card that were itself pressable would turn
 * every aborted swipe into a click, and a button inside a drag surface fires on a
 * gesture that was meant for the card. The decisions live below it, as real buttons —
 * see `MobileModerationPage`. This element carries the photo and the feedback, and
 * nothing else.
 *
 * It is keyed by photo id where it is rendered, so the next photo arrives with the
 * gesture state reset rather than inheriting the last one's offset.
 */

export interface SwipeCardProps {
  readonly photo: ModerationPhotoDto
  /**
   * The photo id travels with the decision.
   *
   * The card knows which photo the gesture began on; the page, by the time the thumb
   * lifts, only knows which photo is in hand. Those are the same today because the card
   * is keyed by id — and naming the photo is what keeps them the same if it ever is not.
   */
  readonly onDecide: (decision: SwipeIntent, photoId: string) => void
  /** No new gesture while a decision is in flight. See `useSwipeDecision`. */
  readonly disabled?: boolean
}

export function SwipeCard({ photo, onDecide, disabled = false }: SwipeCardProps) {
  const swipe = useSwipeDecision({
    onDecide: (decision) => onDecide(decision, photo.id),
    disabled,
  })

  const authorInName = photo.authorName ?? fr.moderation.anonymousInName
  const authorLine =
    photo.authorName === null ? fr.moderation.byAnonymous : fr.moderation.by(photo.authorName)
  const alt =
    photo.caption === null
      ? fr.moderation.photoAlt(authorInName)
      : fr.moderation.photoAltWithCaption(photo.caption, authorInName)

  /**
   * What the card says it is about to do.
   *
   * Two stages, because "this is going to publish" and "let go and it publishes" are
   * different promises, and a host who cannot tell them apart cannot use the second
   * half of the gesture — dragging back — which is the only way to change their mind.
   */
  const hint =
    swipe.intent === null
      ? null
      : swipe.intent === 'publish'
        ? swipe.committed
          ? fr.mobileModeration.releaseToPublish
          : fr.moderation.publish
        : swipe.committed
          ? fr.mobileModeration.releaseToReject
          : fr.moderation.reject

  return (
    <article
      // Part of the e2e contract: tests/e2e drives a real drag through this.
      data-testid="mobile-moderation-card"
      // The direction, as data rather than as a colour. The word in the hint carries
      // the same thing for a host under stage lighting, and these drive the styling.
      data-intent={swipe.intent ?? 'none'}
      data-committed={swipe.committed ? 'true' : 'false'}
      // The card follows the thumb without easing and eases only on the way back; the
      // CSS reads this rather than the component switching a transition on and off.
      data-dragging={swipe.dragging ? 'true' : 'false'}
      className={styles['card']}
      // A computed value, which is the one thing an inline style is for.
      style={{ transform: `translateX(${swipe.offset}px)` }}
      aria-label={fr.moderation.photoOf(authorInName)}
      onPointerDown={swipe.onPointerDown}
    >
      <img
        className={styles['image']}
        src={photo.displayUrl}
        alt={alt}
        // Not lazy: this is the only photo on the screen, and the host is waiting to
        // look at it. Intrinsic size all the same, so the card does not resize under
        // the thumb as the bytes arrive on a venue's Wi-Fi.
        decoding="async"
        width={photo.width}
        height={photo.height}
        // A mouse dragging a photo starts a native image drag otherwise, which takes
        // the pointer events with it and leaves the card stuck mid-swipe.
        draggable={false}
      />

      <div className={styles['meta']}>
        {photo.caption === null ? (
          <p className={styles['captionEmpty']}>{fr.moderation.noCaption}</p>
        ) : (
          <p className={styles['caption']}>{photo.caption}</p>
        )}
        <p className={styles['author']}>{authorLine}</p>
      </div>

      {hint === null ? null : (
        /*
          Announced to nobody. It changes on every pointer move, and a live region
          firing at 60 Hz is worse than silence — the decision buttons below are the
          path that works without sight, and they say the same two words.
        */
        <p
          className={styles['hint']}
          aria-hidden="true"
          // Strengthens as the card travels, so "almost there" is visible rather than a
          // state that appears out of nothing at the threshold.
          style={{ opacity: 0.45 + 0.55 * swipe.progress }}
        >
          {hint}
        </p>
      )}
    </article>
  )
}
