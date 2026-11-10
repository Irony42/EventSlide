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
  saysFirstPhoto,
  nextPhotoUrl,
  POLAROID_PRINTS,
} from '../wallLayoutMath'
import { JoinInvite } from '../JoinInvite'
import styles from '../WallLayouts.module.css'

/**
 * Three prints on a dark ground.
 *
 * The physical-photo metaphor, for a room small enough that it lands: a wedding of sixty
 * rather than a conference. Each photo is mounted on paper with a warm white mat and
 * turned a few degrees, and a print taking its turn lands rather than cuts — which is
 * the whole point of the layout, and therefore the first thing that has to go under
 * `prefers-reduced-motion`. The tilt itself is a static transform and stays: it is a
 * composition, not motion, and a pile of perfectly square prints is just a grid of three.
 *
 * The landing is declared from `data-motion` rather than left to the reduced-motion rule
 * in `base.css`. That rule collapses an animation's *duration*, so a keyframe with `both`
 * lands on its end frame rather than not running — which for Ken Burns means snapping to
 * a zoom (the trap `SlideLayer` documents) and for this one happens to mean landing on
 * the print's resting state, because that is where these keyframes end. "Happens to" is
 * the problem: it is one keyframe edit away from being wrong, on the animation most
 * likely to trigger the symptom the preference exists for. So it is declined here
 * outright rather than left to a global `!important` to defuse.
 */
/** The invitation print's lean: inside the ±2° a camera app reads without a second thought. */
const INVITE_TILT_DEG = -1.5

export function PolaroidLayout({
  items,
  slideshow,
  transitionMs,
  plays,
  tilt: leans = true,
  invite = null,
}: LayoutViewProps) {
  const text = useTranslations()
  const reducedMotion = usePrefersReducedMotion()
  const prints = rotatingSlots(items, slideshow, POLAROID_PRINTS)
  const inviteTilt: TiltStyle = { '--wall-tilt': `${leans ? INVITE_TILT_DEG : 0}deg` }

  return (
    <div
      className={styles['polaroid']}
      style={stageStyleFor(transitionMs)}
      data-motion={reducedMotion ? 'still' : 'landing'}
      data-invite={invite === null ? undefined : 'true'}
    >
      {prints.map((item, slot) => {
        const tilt: TiltStyle = { '--wall-tilt': `${leans ? tiltFor(item.id) : 0}deg` }

        return (
          <figure
            // Keyed by the photo as well as the slot: remounting the print is what
            // restarts the landing animation, and three prints is the whole of it, so
            // the node count is flat whatever the evening does.
            key={`${slot}-${item.id}`}
            className={styles['print']}
            style={tilt}
            data-testid="wall-slide"
            data-photo-id={item.id}
          >
            <span className={styles['printWindow']}>
              <WallMedia
                item={item}
                plays={plays}
                alt={photoAlt(item, text)}
                className={styles['printImage']}
              />
            </span>
            {/* On the mat, not on the photo: the one caption in the product that is ink
                on paper rather than light over an image. */}
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

      {/* One more print at the end of the pile, its window holding the QR. It never takes a turn
          and never lands: a code that moves is a scan that fails. A lean of its own, a little
          less than the others, unless the host turned the lean off. */}
      {invite === null ? null : (
        <div className={styles['polaroidInvite']} style={inviteTilt}>
          <JoinInvite join={invite.join} slot="print" onDismiss={invite.onDismiss} />
        </div>
      )}

      <PhotoPreload url={nextPhotoUrl(slideshow)} />
    </div>
  )
}
