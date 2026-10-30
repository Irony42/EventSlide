import type { CSSProperties } from 'react'
import type { GuestPhotoDto } from '../../../lib/api/dto'
import styles from './GuestBackdrop.module.css'

/**
 * CLEAR-GLASS PROTOTYPE (ADR 0010, "Proposed amendment", variant W2): the guest's own latest
 * photographs as the page's ambient light.
 *
 * A clear pane can only show what is behind it, and what is behind it on this page is the ambiance's
 * ground, which is dark on purpose. So the guest's three most recent photographs are laid under the
 * page, large, blurred and dimmed, the way the wall already does for a photograph's letterbox
 * (`--wall-ambient-image`, `SlideLayer`). Decoration only: no text, hidden from assistive technology,
 * and nothing is fetched that "Vos envois" does not already show (the same thumbnails).
 *
 * What keeps the page legible is a coat of the ambiance's own surface colour over the photographs,
 * derived against the brightest and the darkest photograph there can be (`glass.backdrop.test.ts`).
 */

/** How many photographs share the screen. */
export const BACKDROP_PHOTOS = 3

/** The newest first; a refusal is not what the guest wants to see glowing behind their page. */
export const backdropPhotos = (photos: readonly GuestPhotoDto[]): readonly GuestPhotoDto[] =>
  photos
    .filter((photo) => photo.status !== 'rejected')
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, BACKDROP_PHOTOS)

type TileStyle = CSSProperties & { readonly '--backdrop-image': string }

export function GuestBackdrop({ photos }: { readonly photos: readonly GuestPhotoDto[] }) {
  const chosen = backdropPhotos(photos)
  if (chosen.length === 0) return null

  return (
    <div className={styles['backdrop']} aria-hidden="true" data-testid="guest-backdrop">
      <div className={styles['photos']}>
        {chosen.map((photo) => {
          // A computed value, so an inline custom property is the legitimate carrier (as on the
          // wall); JSON quoting keeps the URL a single CSS string.
          const style: TileStyle = { '--backdrop-image': `url(${JSON.stringify(photo.thumbUrl)})` }
          return <span key={photo.id} className={styles['tile']} style={style} />
        })}
      </div>
    </div>
  )
}
