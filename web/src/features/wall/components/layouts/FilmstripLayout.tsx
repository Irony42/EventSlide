import type { WallItemDto } from '../../../../lib/api/dto'
import type { CSSProperties } from 'react'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import { useTranslations } from '../../../../lib/i18n/useTranslations'
import { photoAlt } from '../../../../lib/photoAlt'
import { PhotoPreload } from '../PhotoPreload'
import { WallMedia } from '../WallMedia'
import { stageStyleFor, type LayoutViewProps, type DriftStyle } from './layoutProps'
import { playlistWindow, nextPhotoUrl, FILMSTRIP_FRAMES } from '../wallLayoutMath'
import { JoinInvite } from '../JoinInvite'
import styles from '../WallLayouts.module.css'

/**
 * A band of five photos drifting slowly sideways.
 *
 * For a cocktail hour where nobody watches continuously: there is no moment to miss,
 * because the strip is always mid-move. It holds one frame more than it shows — the next
 * photo waits off the right edge — and each interval the track travels exactly one frame
 * width while the window it renders advances by exactly one photo. The two cancel, so
 * the strip appears to move continuously while the DOM holds six figures all evening.
 *
 * Three things keep that honest. The drift is timed from `slideshow.intervalMs`, the same
 * number the slide clock runs on, so it can neither outlast its slide nor finish early
 * and freeze — 1.0's Ken Burns bug, which is exactly what a second duration setting
 * would reintroduce here. The track is keyed on the index, so the animation restarts at
 * the instant the content changes rather than drifting out of phase with it over eight
 * hours. And `data-strip` anchors a full strip at its start edge, because a centred flex
 * container splits its overflow across both edges and the drift would then open a blank
 * tenth of the screen on the right at the end of every slide.
 *
 * A playlist shorter than the strip does not drift at all: there is nothing to drift
 * towards, and rotating five photos through five frames would move faces around the wall
 * for no reason.
 *
 * Neither does a wall that is not advancing — paused by the host, or by a hidden tab.
 * `slideshow.intervalMs` is `0` in exactly those cases, which is what makes this one
 * condition rather than two that can disagree. The strip then returns to its rest
 * position instead of freezing part-way: a paused strip stranded mid-travel would resume
 * from a phase its content no longer matches, so "at rest or travelling, never stranded"
 * is the invariant worth having, and the settle happens on a deliberate keypress that
 * already puts a notice on the wall.
 */
export function FilmstripLayout({
  items,
  slideshow,
  transitionMs,
  plays,
  invite = null,
}: LayoutViewProps) {
  const text = useTranslations()
  const reducedMotion = usePrefersReducedMotion()
  const scrolls = items.length > FILMSTRIP_FRAMES
  // A strip that scrolls is the photo on screen and the slides the wall has planned after
  // it, so a photo that has just been published is the next frame in, rather than a jump to
  // the head of the playlist and a jump back.
  const frames = scrolls
    ? [slideshow.current, ...slideshow.upcoming]
        .filter((item): item is WallItemDto => item !== null)
        .slice(0, FILMSTRIP_FRAMES + 1)
    : playlistWindow(items, 0, FILMSTRIP_FRAMES + 1)
  const drifts = scrolls && !reducedMotion && slideshow.intervalMs > 0
  const driftStyle: CSSProperties | DriftStyle = drifts
    ? { '--wall-drift-duration': `${slideshow.intervalMs}ms` }
    : {}

  return (
    <div className={styles['filmstrip']} style={stageStyleFor(transitionMs)}>
      <div
        // The generation, so the drift restarts in step with the window it is moving. The
        // index would do until a photo jumped the queue and it could repeat.
        key={scrolls ? slideshow.generation : 'still'}
        className={styles['track']}
        style={driftStyle}
        // Whether the strip overflows, which decides where it is anchored. Not the same
        // question as whether it is currently moving: a full strip under reduced motion
        // still overflows and must still be anchored at the start.
        data-strip={scrolls ? 'scrolling' : 'short'}
        data-motion={drifts ? 'drift' : 'still'}
      >
        {frames.map((item, frame) => (
          <figure
            key={`${frame}-${item.id}`}
            className={styles['frame']}
            data-testid="wall-slide"
            data-photo-id={item.id}
          >
            <WallMedia
              item={item}
              plays={plays}
              alt={photoAlt(item, text)}
              className={styles['frameImage']}
            />
          </figure>
        ))}
      </div>

      {/* A ticket in the band under the strip, in the flow rather than over it: the strip drifts
          above and never passes beneath the code. */}
      {invite === null ? null : (
        <JoinInvite
          join={invite.join}
          slot="band"
          onDismiss={invite.onDismiss}
          className={styles['filmstripInvite']}
        />
      )}

      <PhotoPreload url={nextPhotoUrl(slideshow)} />
    </div>
  )
}
