import { useEffect } from 'react'
import { Button } from '../../../design-system/components/Button'
import { Dialog } from '../../../design-system/components/Dialog'
import { fr } from '../../../lib/i18n/fr'
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
  const showing = open && photo !== null

  useEffect(() => {
    if (!showing) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
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

  const authorInName = photo.authorName ?? fr.moderation.anonymousInName
  const authorLine =
    photo.authorName === null ? fr.moderation.byAnonymous : fr.moderation.by(photo.authorName)
  const alt =
    photo.caption === null
      ? fr.moderation.photoAlt(authorInName)
      : fr.moderation.photoAltWithCaption(photo.caption, authorInName)

  return (
    <Dialog
      open={showing}
      title={fr.moderation.photoOf(authorInName)}
      onClose={onClose}
      // Coalesced because a CSS module is typed as an index signature, so it is string-or-undefined.
      className={styles['lightbox'] ?? ''}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onPrevious}>
            {fr.moderation.previousPhoto}
          </Button>
          <Button variant="ghost" size="sm" onClick={onNext}>
            {fr.moderation.nextPhoto}
          </Button>
          <Button
            variant="primary"
            aria-label={fr.moderation.publishPhoto(authorInName)}
            onClick={() => onDecide(photo.id, 'publish')}
          >
            {fr.moderation.publish}
          </Button>
          <Button
            variant="danger"
            aria-label={fr.moderation.rejectPhoto(authorInName)}
            onClick={() => onDecide(photo.id, 'reject')}
          >
            {fr.moderation.reject}
          </Button>
          <Button
            variant="secondary"
            aria-label={fr.moderation.hidePhoto(authorInName)}
            onClick={() => onDecide(photo.id, 'hide')}
          >
            {fr.moderation.hide}
          </Button>
        </>
      }
    >
      <figure className={styles['figure']}>
        <img
          className={styles['image']}
          src={photo.displayUrl}
          alt={alt}
          // Not lazy, unlike the grid: this is the one photo the host is looking at.
          decoding="async"
          width={photo.width}
          height={photo.height}
        />
        <figcaption className={styles['caption']}>
          {photo.caption === null ? null : (
            <span className={styles['captionText']}>{photo.caption}</span>
          )}
          <span className={styles['author']}>{authorLine}</span>
        </figcaption>
      </figure>
    </Dialog>
  )
}
