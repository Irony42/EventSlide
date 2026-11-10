import { useTranslations } from '../../../../lib/i18n/useTranslations'
import { photoAlt } from '../../../../lib/photoAlt'
import { PhotoPreload } from '../PhotoPreload'
import { WallMedia } from '../WallMedia'
import { stageStyleFor, type LayoutViewProps } from './layoutProps'
import { rotatingSlots, nextPhotoUrl, COLLAGE_CELLS } from '../wallLayoutMath'
import { JoinInvite } from '../JoinInvite'
import styles from '../WallLayouts.module.css'

/**
 * A grid that composes itself as the evening goes on.
 *
 * It starts on one photo and gains a cell per slide, so the room watches the wall fill —
 * which is the reward the layout exists for, and the reason it is the one layout that
 * deliberately shows less than it could at the start of the night.
 *
 * How full it is comes from `generation`, the count of slides this screen has shown,
 * rather than from the playlist position: the position wraps and would make the grid
 * shrink again every time the wall came round. That is a per-screen number and it is
 * meant to be — `generation` starts at zero on every load, so a kiosk that reloads at
 * 23:00 drops back to one cell and refills over the next twelve slides. Two projectors
 * handed the same index compose the same grid; two projectors that have been running
 * for different lengths of time do not, and nothing in this build gives them a shared
 * cursor to fix that with (see `useSlideshow`, which adopts the newest photo on its own
 * first frame).
 *
 * Twelve mirrors `wallLayoutSpec('collage').slotCount`, and mirroring is all it can do:
 * the import boundary in `eslint.config.mjs` keeps the domain out of `web/`, so the two
 * declarations can drift. If they do, the visible consequence is a grid that stops
 * growing before or after the spec says it should — nothing breaks, and nothing catches
 * it either. `COLLAGE_CELLS` is the one the room sees.
 */
/**
 * Cells the collage's invitation holds: its whole last column. Three rows because two (about
 * 650 px on a 1080p wall, 410 px on a 720p one) are shorter than the QR and its words at the
 * host's largest scale, and a QR is never cropped to fit a cell.
 */
const INVITE_CELLS = 3

export function CollageLayout({
  items,
  slideshow,
  transitionMs,
  plays,
  invite = null,
}: LayoutViewProps) {
  const text = useTranslations()
  const composed = rotatingSlots(
    items,
    slideshow,
    invite === null ? COLLAGE_CELLS : COLLAGE_CELLS - INVITE_CELLS,
  )
  const filled = Math.min(slideshow.generation + 1, composed.length)
  const cells = composed.slice(0, filled)

  return (
    <div className={styles['collage']} style={stageStyleFor(transitionMs)}>
      {cells.map((item, slot) => (
        <figure
          // The cell, not the photo: a cell already on the wall must not re-run its
          // arrival animation when the one next to it appears.
          key={slot}
          className={styles['cell']}
          data-testid="wall-slide"
          data-photo-id={item.id}
        >
          <WallMedia
            key={item.id}
            item={item}
            plays={plays}
            alt={photoAlt(item, text)}
            className={styles['image']}
          />
        </figure>
      ))}

      {/* A place the composition keeps for the next guest, from the first photograph on. */}
      {invite === null ? null : (
        <JoinInvite
          join={invite.join}
          slot="cell"
          onDismiss={invite.onDismiss}
          className={styles['collageInvite']}
        />
      )}

      <PhotoPreload url={nextPhotoUrl(slideshow)} />
    </div>
  )
}
