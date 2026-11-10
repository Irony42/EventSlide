import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import { useTranslations } from '../../../../lib/i18n/useTranslations'
import { photoAlt } from '../../../../lib/photoAlt'
import { PhotoPreload } from '../PhotoPreload'
import { SlideCaption } from '../SlideCaption'
import { WallMedia } from '../WallMedia'
import { stageStyleFor, type LayoutViewProps, type TiltStyle } from './layoutProps'
import {
  rotatingSlots,
  tiltFor,
  newestOf,
  saysFirstPhoto,
  nextPhotoUrl,
  CLOTHESLINE_PRINTS,
} from '../wallLayoutMath'
import { JoinInvite } from '../JoinInvite'
import styles from '../WallLayouts.module.css'

/**
 * Three to five prints pegged to a string, swaying a little.
 *
 * The polaroid's cousin for a garden party: the same cream-bordered paper, the same tilt
 * derived from the photo id, hung by a wooden clothespin from a string that crosses the
 * wall. It shows up to five prints and fewer while the playlist is shorter, so the string
 * is never longer than what hangs on it.
 *
 * The newest print is the one the room should look at, so it hangs a little larger and
 * casts the deeper shadow. Nothing is coloured: the accent is reserved for the action.
 *
 * The sway is the second thing on the wall that loops. It is declared from `data-motion`
 * for the reason the polaroid's landing is: a collapsed duration under
 * `prefers-reduced-motion` would leave an infinite animation at a frame nobody chose. A
 * wall that is not advancing is held still as well — the strip's rule, and what makes a
 * baseline of this layout the print at rest rather than the frame the shutter reached.
 */
export function ClotheslineLayout({
  items,
  slideshow,
  transitionMs,
  plays,
  tilt: leans = true,
  invite = null,
}: LayoutViewProps) {
  const text = useTranslations()
  const reducedMotion = usePrefersReducedMotion()
  const prints = rotatingSlots(items, slideshow, CLOTHESLINE_PRINTS)
  const newest = newestOf(prints)
  const sways = !reducedMotion && slideshow.intervalMs > 0

  return (
    <div
      className={styles['clothesline']}
      style={stageStyleFor(transitionMs)}
      data-motion={sways ? 'swaying' : 'still'}
    >
      <div className={styles['line']}>
        {prints.map((item, slot) => {
          const tilt: TiltStyle = { '--wall-tilt': `${leans ? tiltFor(item.id) : 0}deg` }

          return (
            <figure
              // The slot and the photo: a print taking its turn is a new element, which
              // restarts its fade-in, and five of them is the whole of the node count.
              key={`${slot}-${item.id}`}
              className={styles['hung']}
              style={tilt}
              data-testid="wall-slide"
              data-photo-id={item.id}
              data-newest={item.id === newest ? 'true' : undefined}
            >
              {/* Over the mat's top border, never over the photograph. */}
              <span className={styles['pin']} aria-hidden="true" />
              <span className={styles['printWindow']}>
                <WallMedia
                  item={item}
                  plays={plays}
                  alt={photoAlt(item, text)}
                  className={styles['image']}
                />
              </span>
              <SlideCaption
                caption={item.caption}
                authorName={item.authorName}
                sentAt={item.createdAt}
                firstFromGuest={saysFirstPhoto(item, slideshow)}
                variant="print"
              />
            </figure>
          )
        })}
        {/* A tag threaded at the end of the string. Not a `.hung`, so it is the one thing on the
            line that never sways: a code that moves is a scan that fails. */}
        {invite === null ? null : (
          <div className={styles['tagHolder']}>
            <span className={styles['pin']} aria-hidden="true" />
            <JoinInvite join={invite.join} slot="tag" onDismiss={invite.onDismiss} />
          </div>
        )}
      </div>

      <PhotoPreload url={nextPhotoUrl(slideshow)} />
    </div>
  )
}
