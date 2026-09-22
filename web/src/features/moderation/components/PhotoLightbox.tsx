import { useEffect, useState } from 'react'
import { Button } from '../../../design-system/components/Button'
import { Dialog } from '../../../design-system/components/Dialog'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { ModerationDecision, ModerationPhotoDto } from '../../../lib/api/dto'
import styles from './PhotoLightbox.module.css'

/**
 * One photo, full size, with the decisions attached.
 *
 * A 240 px tile is not enough to judge a photo that is about to be projected three
 * metres wide: who is in it, whether it is in focus, what is written on the sign
 * behind. So the host opens it, and — this is the part that makes it usable during a
 * party — walks the queue with the arrow keys without going back to the grid.
 *
 * The modal itself is the design system's `Dialog`: native `<dialog>`, focus trap,
 * Escape, and focus returned to the tile that opened it.
 */

export interface PhotoLightboxProps {
  readonly photo: ModerationPhotoDto | null
  readonly open: boolean
  readonly onClose: () => void
  readonly onPrevious: () => void
  readonly onNext: () => void
  readonly onDecide: (photoId: string, decision: ModerationDecision) => void
}

export function PhotoLightbox({
  photo,
  open,
  onClose,
  onPrevious,
  onNext,
  onDecide,
}: PhotoLightboxProps) {
  const t = useTranslations()
  const showing = open && photo !== null

  /**
   * The photo whose clip this browser refused, if any.
   *
   * By id rather than as a boolean, because the host walks the queue from inside this
   * modal: a flag would carry one broken clip's notice onto every photo after it.
   */
  const [unplayable, setUnplayable] = useState<string | null>(null)

  useEffect(() => {
    if (!showing) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      // A focused `<video>` owns its own arrows: they seek. Taking them would leave the
      // host unable to scrub back over the two seconds they need to look at again —
      // on the one surface whose whole job is deciding about those two seconds.
      if (event.target instanceof HTMLMediaElement) return
      // Claimed, so the page's single-key shortcuts do not also act on it, and so the
      // browser does not scroll the grid behind the modal.
      event.preventDefault()
      if (event.key === 'ArrowLeft') onPrevious()
      else onNext()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showing, onPrevious, onNext])

  if (photo === null) return null

  const authorInName = photo.authorName ?? t.moderation.anonymousInName
  const authorLine =
    photo.authorName === null ? t.moderation.byAnonymous : t.moderation.by(photo.authorName)
  const isClip = photo.kind === 'clip' && photo.videoUrl !== null
  const alt = isClip
    ? photo.caption === null
      ? t.moderation.videoAlt(authorInName)
      : t.moderation.videoAltWithCaption(photo.caption, authorInName)
    : photo.caption === null
      ? t.moderation.photoAlt(authorInName)
      : t.moderation.photoAltWithCaption(photo.caption, authorInName)

  return (
    <Dialog
      open={showing}
      title={isClip ? t.moderation.videoOf(authorInName) : t.moderation.photoOf(authorInName)}
      onClose={onClose}
      // Coalesced because a CSS module is typed as an index signature, so it is string-or-undefined.
      className={styles['lightbox'] ?? ''}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onPrevious}>
            {t.moderation.previousPhoto}
          </Button>
          <Button variant="ghost" size="sm" onClick={onNext}>
            {t.moderation.nextPhoto}
          </Button>
          <Button
            variant="primary"
            aria-label={t.moderation.publishPhoto(authorInName)}
            onClick={() => onDecide(photo.id, 'publish')}
          >
            {t.moderation.publish}
          </Button>
          <Button
            variant="danger"
            aria-label={t.moderation.rejectPhoto(authorInName)}
            onClick={() => onDecide(photo.id, 'reject')}
          >
            {t.moderation.reject}
          </Button>
          <Button
            variant="secondary"
            aria-label={t.moderation.hidePhoto(authorInName)}
            onClick={() => onDecide(photo.id, 'hide')}
          >
            {t.moderation.hide}
          </Button>
        </>
      }
    >
      <figure className={styles['figure']}>
        {isClip && photo.videoUrl !== null ? (
          /*
            The desktop console's answer to "a poster frame is not a decision about
            fifteen seconds of video".

            Native controls, and **with sound**: the host is deciding what goes on a wall
            in front of two hundred people, and half of what makes a clip unsuitable is
            audible rather than visible. Playback starts from their own click, so the
            browser's autoplay policy has nothing to object to — which is exactly why
            this element is not muted and the wall's is.

            `preload="metadata"` so opening a tile does not pull the whole file over a
            venue's Wi-Fi before the host has decided to watch it, and `poster` so the
            first frame is on screen immediately either way.
          */
          <video
            // Keyed by the photo, so walking the queue with the arrow keys **remounts**
            // the player rather than mutating `src` on a live one. Without it the
            // previous clip's scrub position, buffered data and error state survive onto
            // the next photo, and a host who hit a broken clip sees a dead player on
            // every one after it.
            key={photo.id}
            className={styles['image']}
            src={photo.videoUrl}
            poster={photo.displayUrl}
            controls
            playsInline
            preload="metadata"
            // A source this browser cannot open. The poster stays on screen behind the
            // controls either way; this is what tells the host that is all they are
            // getting, rather than leaving them pressing play on a dead element.
            onError={() => setUnplayable(photo.id)}
            // A `<video>` has no `alt`; this is what a screen reader announces instead,
            // and without it the element is "video" and nothing else.
            aria-label={alt}
            width={photo.width}
            height={photo.height}
          />
        ) : (
          <img
            className={styles['image']}
            src={photo.displayUrl}
            alt={alt}
            // Not lazy, unlike the grid: this is the one photo the host is looking at.
            decoding="async"
            width={photo.width}
            height={photo.height}
          />
        )}
        <figcaption className={styles['caption']}>
          {unplayable === photo.id ? (
            <span className={styles['captionText']} role="status">
              {t.moderation.videoUnplayable}
            </span>
          ) : null}
          {photo.caption === null ? null : (
            <span className={styles['captionText']}>{photo.caption}</span>
          )}
          <span className={styles['author']}>{authorLine}</span>
        </figcaption>
      </figure>
    </Dialog>
  )
}
