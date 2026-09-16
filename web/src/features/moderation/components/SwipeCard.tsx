import { useEffect, useRef } from 'react'
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
  /**
   * Whether the clip on this card should be running.
   *
   * Owned by the page, not by the card, and that is the whole design of playback on this
   * surface. The control that starts and stops it is a **real button in the action bar
   * below**, because this element is a drag surface and nothing inside it may be
   * pressable: a button in here fires on a gesture that was meant for the card, and an
   * aborted swipe becomes a tap. The card is told what to do and does it.
   *
   * Ignored for a photograph.
   */
  readonly playing?: boolean
  /**
   * Something happened to playback that the host did not ask for.
   *
   * - `ended` — the clip ran out. Put the button back.
   * - `failed` — this phone will not play it. The host still has to decide, from the
   *   poster and the caption, and has to be **told** that is all they are getting: a clip
   *   that silently will not play leaves a card whose only control says "mettre en pause"
   *   for ever, toggling a state nothing acts on.
   * - `muted` — the browser refused sound, so it is playing without. Said out loud
   *   because a moderator judging fifteen seconds of a speech would otherwise approve it
   *   on half the evidence and never know.
   */
  readonly onPlaybackEnded?: (reason: 'ended' | 'failed' | 'muted') => void
}

export function SwipeCard({
  photo,
  onDecide,
  disabled = false,
  playing = false,
  onPlaybackEnded,
}: SwipeCardProps) {
  const swipe = useSwipeDecision({
    onDecide: (decision) => onDecide(decision, photo.id),
    disabled,
  })

  const video = useRef<HTMLVideoElement | null>(null)
  const isClip = photo.kind === 'clip' && photo.videoUrl !== null

  /**
   * The failure callback, held in a ref.
   *
   * The effect below must run on `playing` alone: depending on a callback the page
   * writes as an inline arrow would re-run it on every render of the console — and
   * re-running it means calling `play()` again on an element that is already playing,
   * every time a photo arrives over the stream.
   */
  const reportRef = useRef<((reason: 'failed' | 'muted') => void) | undefined>(undefined)
  useEffect(() => {
    reportRef.current = onPlaybackEnded
  }, [onPlaybackEnded])

  /**
   * Playback follows the prop, in an effect, because `play()` is an imperative call on a
   * DOM node and there is no declarative form of it.
   *
   * `play()` returns a promise that **rejects**, and what is done with that rejection is
   * the whole of this block. A card unmounted mid-gesture aborts it and there is nothing
   * to say; anything else — a source this phone cannot decode, a policy nobody predicted
   * — means the button the host just pressed did nothing, and swallowing it leaves a
   * control reading "mettre en pause" for the rest of the evening over a still frame.
   * So it is reported, and the page puts the button back and says why.
   */
  useEffect(() => {
    const element = video.current
    if (element === null) return
    if (!playing) {
      element.pause()
      return
    }

    // Sound by default, because half of what makes a clip unsuitable is audible and this
    // is the surface that decides. The click that set `playing` is a user gesture, so an
    // unmuted start is ordinarily allowed.
    element.muted = false
    void element.play().catch((cause: unknown) => {
      // The card's own doing: the photo changed under the gesture and this element is
      // gone. There is no host waiting on it and nothing to report.
      if (cause instanceof DOMException && cause.name === 'AbortError') return

      /**
       * Refused. The one refusal worth arguing with is the autoplay policy.
       *
       * This effect runs a task after the click, and some browsers no longer count the
       * gesture by then — so an unmuted `play()` is refused where a muted one is not.
       * A silent clip the host can watch is a far better decision than a poster frame,
       * so it is retried muted and the loss of sound is reported rather than hidden.
       */
      if (!(cause instanceof DOMException) || cause.name !== 'NotAllowedError') {
        reportRef.current?.('failed')
        return
      }
      element.muted = true
      void element.play().then(
        () => reportRef.current?.('muted'),
        () => reportRef.current?.('failed'),
      )
    })
  }, [playing])

  const authorInName = photo.authorName ?? fr.moderation.anonymousInName
  const authorLine =
    photo.authorName === null ? fr.moderation.byAnonymous : fr.moderation.by(photo.authorName)
  const alt = isClip
    ? photo.caption === null
      ? fr.moderation.videoAlt(authorInName)
      : fr.moderation.videoAltWithCaption(photo.caption, authorInName)
    : photo.caption === null
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
      aria-label={
        isClip ? fr.moderation.videoOf(authorInName) : fr.moderation.photoOf(authorInName)
      }
      onPointerDown={swipe.onPointerDown}
    >
      {isClip && photo.videoUrl !== null ? (
        /*
          The clip, and deliberately **without `controls`**.

          Native controls here would be a row of buttons inside the drag surface: every
          tap near the bottom of the card would be a scrub rather than a swipe, and every
          swipe that started there would be a scrub too. The play control lives in the
          action bar below, as a real button — which is also the path a screen reader
          takes, and on this surface the buttons are the interface rather than a fallback.

          `playsinline` is what keeps it on the card at all: without it iOS takes the
          video fullscreen the moment it starts, and the host is then looking at a player
          instead of at the card they were about to swipe.

          `touch-action` is not set here and must not be: the browser intersects
          `touch-action` from the hit element up through its ancestors, so the card's
          `pan-y` already governs a touch that lands on this element. Declaring `auto`
          here would widen it back and hand the horizontal axis to the scroller — the
          exact failure `SwipeCard.module.css` documents.
        */
        <video
          ref={video}
          className={styles['image']}
          src={photo.videoUrl}
          poster={photo.displayUrl}
          playsInline
          preload="metadata"
          // A `<video>` has no `alt`; this is what a screen reader announces instead.
          aria-label={alt}
          width={photo.width}
          height={photo.height}
          draggable={false}
          onEnded={() => onPlaybackEnded?.('ended')}
          // A source the phone refused, or one that stopped decoding part-way. Without
          // it the only control on the screen goes on claiming the clip is playing.
          onError={() => onPlaybackEnded?.('failed')}
        />
      ) : (
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
      )}

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
