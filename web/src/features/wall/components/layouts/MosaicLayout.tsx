import { cx } from '../../../../design-system/classNames'
import { mosaicFit } from '../../mosaicFit'
import { useTranslations } from '../../../../lib/i18n/useTranslations'
import { photoAlt } from '../../../../lib/photoAlt'
import { PhotoPreload } from '../PhotoPreload'
import { SlideCaption } from '../SlideCaption'
import { WallMedia } from '../WallMedia'
import { stageStyleFor, type LayoutViewProps } from './layoutProps'
import { rotatingSlots, nextPhotoUrl, MOSAIC_SLOTS } from '../wallLayoutMath'
import { JoinInvite } from '../JoinInvite'
import styles from '../WallLayouts.module.css'

/**
 * Six photos at once on a fixed grid.
 *
 * One of the layouts allowed to crop, because tiles have to tessellate — a host choosing
 * it is choosing that trade. No captions: at six tiles a caption is unreadable from five
 * metres, and unreadable text over a photo is just dirt on the lens. The author stays,
 * because a name is short enough to survive the size.
 *
 * The geometry is fixed in CSS, so a photo arriving mid-evening never reshuffles the
 * wall — it takes a tile's next turn and nothing moves.
 */
export function MosaicLayout({
  items,
  slideshow,
  transitionMs,
  plays,
  invite = null,
}: LayoutViewProps) {
  const text = useTranslations()
  // The invitation takes the last cell, so the grid never moves and nothing passes under it:
  // five photographs and a place left for a guest, back to six the moment it is put away.
  const tiles = rotatingSlots(items, slideshow, invite === null ? MOSAIC_SLOTS : MOSAIC_SLOTS - 1)

  return (
    <div className={styles['mosaic']} style={stageStyleFor(transitionMs)}>
      {tiles.map((item, slot) => (
        <figure
          key={slot}
          className={cx(styles['tile'], styles[`slot${slot}`])}
          // The photo this tile is holding. Same reason as the spotlight's: the tile a
          // mosaic gives a photo is derived from the index alone, and this is what lets
          // two projectors be shown to agree tile for tile.
          data-testid="wall-slide"
          data-photo-id={item.id}
          data-fit={mosaicFit(item)}
        >
          {mosaicFit(item) === 'contain' ? (
            <span
              className={styles['tileAmbient']}
              aria-hidden="true"
              style={{
                ['--wall-ambient-image' as string]: `url(${JSON.stringify(item.thumbUrl)})`,
              }}
            />
          ) : null}
          <WallMedia
            // Keyed by the photo, so a tile taking its turn fades its new photo in
            // rather than swapping it under the viewer's eye.
            key={item.id}
            item={item}
            plays={plays}
            alt={photoAlt(item, text)}
            className={styles['image']}
          />
          <SlideCaption
            caption={null}
            authorName={item.authorName}
            sentAt={item.createdAt}
            variant="tile"
          />
        </figure>
      ))}

      {invite === null ? null : (
        <JoinInvite
          join={invite.join}
          slot="tile"
          onDismiss={invite.onDismiss}
          className={styles[`slot${MOSAIC_SLOTS - 1}`]}
        />
      )}

      {/* The next tile to turn shows exactly the slideshow's next photo. */}
      <PhotoPreload url={nextPhotoUrl(slideshow)} />
    </div>
  )
}
