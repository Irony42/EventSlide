import type { CSSProperties, ReactNode } from 'react'
import type { WallItemDto } from '../../../lib/api/dto'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { photoAlt } from '../photoAlt'
import { PhotoPreload } from './PhotoPreload'
import { WallMedia } from './WallMedia'
import styles from './SlideLayer.module.css'

/** Computed values, so an inline custom property is the legitimate carrier. */
type StageStyle = CSSProperties & { readonly '--wall-transition': string }
type SlideStyle = CSSProperties & { readonly '--wall-kenburns-duration': string }

export interface SlideLayerProps {
  readonly current: WallItemDto | null
  /** The photo leaving the screen, so there is something to fade out. */
  readonly previous: WallItemDto | null
  /** The photo after this one. Mounted hidden and decoded before it is needed. */
  readonly next: WallItemDto | null
  /** Straight from the wall response. Never a constant — that was the 1.0 bug. */
  readonly kenBurnsDurationMs: number
  /** `null` uses `--duration-slow`; the e2e hook passes `0` for a cut. */
  readonly transitionMs: number | null
  /**
   * Whether this wall is going to change photo at all.
   *
   * `slideshow.intervalMs > 0` — the same number `FilmstripLayout` times its drift from,
   * and read here for the same reason. There are exactly two animations on this wall
   * timed from the slide interval, the drift and this zoom, and until now only one of
   * them stopped when the wall did. That asymmetry was not a decision anybody took; it
   * is the drift's fix never having been generalised.
   *
   * **The zoom is not a duration of its own.** `kenBurnsDurationMs` is
   * `interval + CROSSFADE_MS` (`src/domain/slideshow/kenBurns.ts`), which is what keeps
   * it from ever finishing under a photograph the room is still looking at. That holds
   * while the wall is advancing and stops holding the moment the interval is `0` — a
   * one-photo playlist, the host's space bar, a hidden tab — where an 8 800 ms animation
   * runs off a cadence the wall is not keeping, ends, and holds `scale(1.08)`. Nobody in
   * the room sees that, because this animation's end frame happens to be a photograph
   * standing still. "Happens to" is the problem, and it is the same one `PolaroidLayout`
   * refuses to rest its landing on: it is one keyframe edit away from being wrong, on the
   * wall's most expensive animation. So the wall declines it outright instead.
   *
   * **What it costs:** pausing mid-zoom now settles the photograph to its natural size
   * rather than holding it part-enlarged, so a host's space bar moves the picture by up
   * to 8%. That is the trade the filmstrip already takes and states — at rest or moving,
   * never stranded — for a settle of 384px, and it happens on a deliberate keypress that
   * is already putting a notice on the wall.
   */
  readonly advancing: boolean
  /** Monotonic slide counter, used to give each layer a permanent slot. */
  readonly generation: number
  readonly caption?: ReactNode
  /**
   * Whether a clip plays here. Resolved from the layout's spec by `WallLayouts` and
   * passed through; this component does not decide it and must not.
   *
   * Both layers get the same answer, and only the front one runs — see `paused` below.
   * The outgoing layer keeps its `<video>` and stops it, so the dissolve fades out the
   * frame the room was watching rather than snapping back to the poster, and the wall
   * still decodes exactly one stream at a time, which is `spotlight`'s budget.
   */
  readonly plays?: boolean
}

const SLOTS = [0, 1] as const

/**
 * The crossfade: two recycled layers over black.
 *
 * Three things here are load-bearing on a projector, and all three were broken in 1.0:
 *
 * 1. **The incoming photo is already decoded** (see `PhotoPreload`), so the dissolve
 *    paints a real image instead of a blank frame on venue Wi-Fi.
 * 2. **The two layers are permanent.** Each slot keeps its `<figure>` for the whole
 *    evening — nothing mounts, unmounts or moves per slide — so the node count is flat
 *    across eight hours and no CSS animation is restarted by a DOM move.
 * 3. **The photo is letterboxed, never cropped.** The image box is the photo's own
 *    aspect ratio centred on `--surface-base`, so a portrait phone shot is projected
 *    upright and whole rather than filled to the frame with somebody's head outside it.
 */
export function SlideLayer({
  current,
  previous,
  next,
  kenBurnsDurationMs,
  transitionMs,
  advancing,
  generation,
  caption,
  plays = false,
}: SlideLayerProps) {
  const reducedMotion = usePrefersReducedMotion()

  /** The two ways the zoom is declined, in one value the attribute and the style share. */
  const zooms = !reducedMotion && advancing

  const front = generation % 2
  const stageStyle: CSSProperties | StageStyle =
    transitionMs === null ? {} : { '--wall-transition': `${transitionMs}ms` }
  // Under reduced motion the duration is not shortened, it is never declared: there is
  // no animation left for it to time. A wall that is not advancing withholds it for the
  // same reason — a duration for an animation nobody declared is a number to fall out of
  // step with the slideshow later.
  const slideStyle: CSSProperties | SlideStyle = zooms
    ? { '--wall-kenburns-duration': `${kenBurnsDurationMs}ms` }
    : {}

  return (
    <div className={styles['stage']} style={stageStyle}>
      {SLOTS.map((slot) => {
        const isFront = slot === front
        const item = isFront ? current : previous
        // The outgoing slot goes quiet once it holds the same photo as the front one,
        // which happens when the playlist shifted rather than the slide advancing.
        const showsItem = item !== null && (isFront || item.id !== current?.id)

        return (
          <figure
            // The slot, never the photo: this element outlives every photo it shows.
            key={slot}
            className={[styles['slide'], isFront ? styles['front'] : ''].filter(Boolean).join(' ')}
            style={slideStyle}
            // Ken Burns is declared from this attribute rather than unconditionally,
            // because base.css collapses animation *duration* under reduced motion and
            // a 0.01ms `scale(1.08)` with `both` snaps to the zoomed frame and stays —
            // and because a wall that is not advancing has no interval for the zoom to
            // be derived from, which is what `advancing` above argues.
            data-motion={zooms ? 'kenburns' : 'still'}
            // Which photo this layer is holding, named on the element itself.
            //
            // The position is derived from the playlist and never stored, so without
            // this there is nothing outside React that can answer "what is on screen
            // right now" — and that is the question two projectors in one room are
            // compared on, and the one a wall that has silently stopped advancing
            // answers wrongly. It names the photo, never the slot: the slot is
            // permanent and the photo is what changes.
            {...(showsItem && item !== null ? { 'data-photo-id': item.id } : {})}
            {...(isFront && showsItem ? { 'data-testid': 'wall-slide' } : {})}
            // The outgoing copy is announced by nothing: it is the same photo the front
            // layer already named, on its way out.
            {...(isFront ? {} : { 'aria-hidden': true })}
          >
            {showsItem && item !== null ? (
              <WallMedia
                // Keyed by the photo so the element is remade per slide: that is what
                // restarts the Ken Burns animation. The bytes are already in cache from
                // the hidden preload, so the remount paints in the same frame.
                key={item.id}
                item={item}
                plays={plays}
                // The layer behind holds its item for a whole slide after the crossfade.
                // A clip left running there is a second decoder for eight seconds, every
                // slide, on the one layout whose budget is a single stream.
                paused={!isFront}
                // The outgoing copy is the same photo the front layer already named, on
                // its way out, and is `aria-hidden` besides.
                alt={isFront ? photoAlt(item) : ''}
                className={styles['image'] ?? ''}
              />
            ) : null}
            {isFront ? caption : null}
          </figure>
        )
      })}

      <PhotoPreload url={next === null ? null : next.displayUrl} />
    </div>
  )
}
