import type { CSSProperties } from 'react'
import type { WallItemDto, WallLayout } from '../../../lib/api/dto'
import type { Slideshow } from '../hooks/useSlideshow'
import { photoAlt } from '../photoAlt'
import { PhotoPreload } from './PhotoPreload'
import { SlideCaption } from './SlideCaption'
import { SlideLayer } from './SlideLayer'
import styles from './WallLayouts.module.css'

type StageStyle = CSSProperties & { readonly '--wall-transition': string }

interface LayoutViewProps {
  readonly items: readonly WallItemDto[]
  readonly slideshow: Slideshow
  /** From the wall response. Only the spotlight animates. */
  readonly kenBurnsDurationMs: number
  readonly transitionMs: number | null
}

export interface WallLayoutsProps extends LayoutViewProps {
  /** The host's choice, from the wall response. */
  readonly layout: WallLayout
}

/**
 * Photos visible at once in the mosaic.
 *
 * It mirrors `wallLayoutSpec('mosaic').slotCount` in `src/domain/slideshow/`. The wall
 * response carries the layout's *name* and not its spec, so the count lives here as a
 * rendering fact; the things that would actually break if the two disagreed — the
 * playlist window and the interval — do come from the server.
 */
const MOSAIC_SLOTS = 6

/**
 * Which photo a mosaic tile is holding at slide `index`.
 *
 * One tile changes per interval, in turn, rather than all six at once: a whole-wall
 * refresh every eight seconds reads as a fault from across the room, and each photo
 * gets six intervals on screen — which is the reason a host picks the mosaic for a busy
 * cocktail hour in the first place. Derived purely from the index, so two projectors on
 * the same event agree tile for tile.
 */
const mosaicItem = (
  items: readonly WallItemDto[],
  index: number,
  slot: number,
): WallItemDto | undefined => {
  if (items.length === 0) return undefined
  const sinceItsTurn = (((index - slot) % MOSAIC_SLOTS) + MOSAIC_SLOTS) % MOSAIC_SLOTS
  const turn = index - sinceItsTurn
  // Before a tile's first turn it simply shows the photo at its own position, so the
  // wall is full from the first frame instead of filling in over a minute.
  const position = turn < 0 ? slot : turn
  return items[position % items.length]
}

/** One photo, letterboxed, with its caption and author. The safe default. */
function SpotlightLayout({ slideshow, kenBurnsDurationMs, transitionMs }: LayoutViewProps) {
  const { current, previous, next, generation } = slideshow

  return (
    <SlideLayer
      current={current}
      previous={previous}
      next={next}
      kenBurnsDurationMs={kenBurnsDurationMs}
      transitionMs={transitionMs}
      generation={generation}
      caption={
        current === null ? null : (
          <SlideCaption caption={current.caption} authorName={current.authorName} />
        )
      }
    />
  )
}

/**
 * Six photos at once on a fixed grid.
 *
 * The one layout allowed to crop, because tiles have to tessellate — a host choosing it
 * is choosing that trade. No captions: at six tiles a caption is unreadable from five
 * metres, and unreadable text over a photo is just dirt on the lens. The author stays,
 * because a name is short enough to survive the size.
 *
 * The geometry is fixed in CSS, so a photo arriving mid-evening never reshuffles the
 * wall — it takes a tile's next turn and nothing moves.
 */
function MosaicLayout({ items, slideshow, transitionMs }: LayoutViewProps) {
  const visible = Math.min(MOSAIC_SLOTS, items.length)
  const stageStyle: CSSProperties | StageStyle =
    transitionMs === null ? {} : { '--wall-transition': `${transitionMs}ms` }

  return (
    <div className={styles['mosaic']} style={stageStyle}>
      {Array.from({ length: visible }, (_unused, slot) => {
        const item = mosaicItem(items, slideshow.index, slot)

        return (
          <figure
            key={slot}
            className={`${styles['tile']} ${styles[`slot${slot}`]}`}
            {...(item === undefined ? {} : { 'data-testid': 'wall-slide' })}
          >
            {item === undefined ? null : (
              <img
                // Keyed by the photo, so a tile taking its turn fades its new photo in
                // rather than swapping it under the viewer's eye.
                key={item.id}
                className={styles['image']}
                src={item.displayUrl}
                alt={photoAlt(item)}
                width={item.width}
                height={item.height}
                decoding="async"
              />
            )}
            {item === undefined ? null : (
              <SlideCaption caption={null} authorName={item.authorName} variant="tile" />
            )}
          </figure>
        )
      })}

      {/* The next tile to turn shows exactly the slideshow's next photo. */}
      <PhotoPreload url={slideshow.next === null ? null : slideshow.next.displayUrl} />
    </div>
  )
}

/**
 * The layout switch.
 *
 * `polaroid` and `filmstrip` are in the contract but not yet built. They fall through
 * to the nearest implemented layout rather than rendering nothing — a blank projector
 * in front of two hundred people is the worst outcome available — and the `never`
 * assignment below means adding a fifth layout to `WallLayout` fails the build here
 * instead of silently showing black.
 */
export function WallLayouts({ layout, ...view }: WallLayoutsProps) {
  switch (layout) {
    case 'spotlight':
    case 'polaroid':
      return <SpotlightLayout {...view} />
    case 'mosaic':
    case 'filmstrip':
      return <MosaicLayout {...view} />
    default: {
      const unhandled: never = layout
      return unhandled
    }
  }
}
