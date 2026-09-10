import type { CSSProperties, ReactNode } from 'react'
import type { WallItemDto } from '../../../lib/api/dto'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { photoAlt } from '../photoAlt'
import { PhotoPreload } from './PhotoPreload'
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
  /** Monotonic slide counter, used to give each layer a permanent slot. */
  readonly generation: number
  readonly caption?: ReactNode
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
  generation,
  caption,
}: SlideLayerProps) {
  const reducedMotion = usePrefersReducedMotion()

  const front = generation % 2
  const stageStyle: CSSProperties | StageStyle =
    transitionMs === null ? {} : { '--wall-transition': `${transitionMs}ms` }
  // Under reduced motion the duration is not shortened, it is never declared: there is
  // no animation left for it to time.
  const slideStyle: CSSProperties | SlideStyle = reducedMotion
    ? {}
    : { '--wall-kenburns-duration': `${kenBurnsDurationMs}ms` }

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
            // a 0.01ms `scale(1.08)` with `both` snaps to the zoomed frame and stays.
            data-motion={reducedMotion ? 'still' : 'kenburns'}
            {...(isFront && showsItem ? { 'data-testid': 'wall-slide' } : {})}
            // The outgoing copy is announced by nothing: it is the same photo the front
            // layer already named, on its way out.
            {...(isFront ? {} : { 'aria-hidden': true })}
          >
            {showsItem && item !== null ? (
              <img
                // Keyed by the photo so the element is remade per slide: that is what
                // restarts the Ken Burns animation. The bytes are already in cache from
                // the hidden preload, so the remount paints in the same frame.
                key={item.id}
                className={styles['image']}
                src={item.displayUrl}
                alt={isFront ? photoAlt(item) : ''}
                width={item.width}
                height={item.height}
                decoding="async"
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
