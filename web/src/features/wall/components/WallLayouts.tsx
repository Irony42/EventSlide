import type { CSSProperties } from 'react'
import type { WallItemDto, WallLayout } from '../../../lib/api/dto'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import type { Slideshow } from '../hooks/useSlideshow'
import { photoAlt } from '../photoAlt'
import { PhotoPreload } from './PhotoPreload'
import { SlideCaption } from './SlideCaption'
import { SlideLayer } from './SlideLayer'
import styles from './WallLayouts.module.css'

type StageStyle = CSSProperties & { readonly '--wall-transition': string }
type TiltStyle = CSSProperties & { readonly '--wall-tilt': string }
type DriftStyle = CSSProperties & { readonly '--wall-drift-duration': string }

interface LayoutViewProps {
  readonly items: readonly WallItemDto[]
  readonly slideshow: Slideshow
  /** From the wall response. Only the spotlight animates. */
  readonly kenBurnsDurationMs: number
  readonly transitionMs: number | null
}

export interface WallLayoutsProps extends LayoutViewProps {
  /**
   * The layout to render, already resolved by `WallPage`. In order of precedence: the
   * `L` key's local override, then the display URL's `?layout=`, then the wall
   * response's default. Not "the host's choice" — there is no per-event layout setting;
   * the layout belongs to the screen, not to the event.
   */
  readonly layout: WallLayout
}

/**
 * Photos visible at once, per layout.
 *
 * Each mirrors `wallLayoutSpec(...).slotCount` in `src/domain/slideshow/`. The wall
 * response carries the layout's *name* and not its spec, so the counts live here as
 * rendering facts; the things that would actually break if the two disagreed — the
 * playlist window and the interval — do come from the server.
 *
 * They are also the ceiling on how many `<img>` elements each layout may hold. Nothing
 * below mounts an element per slide: an evening is eight hours and a thousand slides,
 * and a layout whose node count tracks that is a projector that gets slower as the
 * party goes on.
 */
const MOSAIC_SLOTS = 6
const POLAROID_PRINTS = 3
const FILMSTRIP_FRAMES = 5
const COLLAGE_CELLS = 12
const SPLIT_PANES = 2

/**
 * Which photos a rotating layout is holding at slide `index`.
 *
 * One slot changes per interval, in turn, rather than all of them at once: a whole-wall
 * refresh every eight seconds reads as a fault from across the room, and it is what
 * gives each photo `slotCount` intervals on screen — the reason a host picks a
 * multi-slot layout for a busy cocktail hour in the first place. Derived purely from the
 * index, so two projectors on the same event agree slot for slot.
 *
 * The result is as short as the playlist when the playlist is shorter than the grid.
 * Repeating a photo to fill the holes was the alternative and it is worse: the same face
 * twice on one wall reads as a fault, and the moment it would happen is ten minutes
 * after the doors open, when the host is watching the screen hardest.
 */
const rotatingSlots = (
  items: readonly WallItemDto[],
  index: number,
  slotCount: number,
): readonly WallItemDto[] => {
  const visible = Math.min(slotCount, items.length)
  const slots: WallItemDto[] = []

  for (let slot = 0; slot < visible; slot += 1) {
    const sinceItsTurn = (((index - slot) % slotCount) + slotCount) % slotCount
    const turn = index - sinceItsTurn
    // Before a slot's first turn it simply shows the photo at its own position, so the
    // wall is full from the first frame instead of filling in over a minute.
    const position = turn < 0 ? slot : turn
    const item = items[position % items.length]
    // `visible` never exceeds the playlist and the modulo lands inside it, so every slot
    // resolves. This is the narrowing `noUncheckedIndexedAccess` asks for and not a
    // fallback: there is no photo to put in a slot that resolved to nothing, and
    // inventing one is how a wall ends up showing the same face twice.
    if (item !== undefined) slots.push(item)
  }

  return slots
}

/**
 * A consecutive run of the playlist, starting at `from` and wrapping past the end.
 *
 * The filmstrip's shape rather than the mosaic's: the whole strip moves by one photo per
 * interval, so what a frame holds is its distance from the cursor and not a turn of its
 * own.
 */
const playlistWindow = (
  items: readonly WallItemDto[],
  from: number,
  count: number,
): readonly WallItemDto[] => {
  const length = items.length
  if (length === 0) return []

  const visible = Math.min(count, length)
  const start = ((from % length) + length) % length
  const run: WallItemDto[] = []

  for (let step = 0; step < visible; step += 1) {
    const item = items[(start + step) % length]
    // Same narrowing as above: the index is taken modulo a non-empty list.
    if (item !== undefined) run.push(item)
  }

  return run
}

/**
 * How far a print is turned on the pile, in degrees.
 *
 * Deterministic from the photo id, so two projectors in one room tilt the same print the
 * same way — the rule that already governs which photo lands in which slot, applied to
 * the one visual property that would otherwise want `Math.random()`. FNV-1a over the id,
 * the same hash the domain's playlist revision uses, folded into the ±4° the design
 * system allows: further and a print reads as fallen over rather than as placed.
 */
const TILT_RANGE = 9
const FNV_OFFSET_BASIS = 2_166_136_261
const FNV_PRIME = 16_777_619

const tiltFor = (photoId: string): number => {
  let hash = FNV_OFFSET_BASIS
  for (let at = 0; at < photoId.length; at += 1) {
    hash = Math.imul(hash ^ photoId.charCodeAt(at), FNV_PRIME) >>> 0
  }
  return (hash % TILT_RANGE) - (TILT_RANGE - 1) / 2
}

/**
 * How far back the split's left pane reaches for an older upload.
 *
 * The wall plays newest first, so half a playlist back is a photo from earlier in the
 * evening — the pairing this layout exists for. It is only a pairing once there is an
 * older end to reach: under four photos the two panes are the two most recent, because a
 * lag of one on a three-photo playlist would put the same face in both halves.
 */
const splitLag = (length: number): number => (length < 4 ? 0 : Math.floor(length / 2))

/**
 * The two halves of the split, at slide `index`.
 *
 * The panes take their turn alternately — the same derivation the mosaic uses, with two
 * slots — so one half is always stable while the other changes. A wall where both halves
 * cut at once is two slideshows, not a pairing, and there is nothing left for the eye to
 * rest on.
 */
const splitPanes = (items: readonly WallItemDto[], index: number): readonly WallItemDto[] => {
  const length = items.length
  if (length === 0) return []

  const visible = Math.min(SPLIT_PANES, length)
  const lag = splitLag(length)
  const panes: WallItemDto[] = []

  for (let pane = 0; pane < visible; pane += 1) {
    const sinceItsTurn = (((index - pane) % SPLIT_PANES) + SPLIT_PANES) % SPLIT_PANES
    const turn = index - sinceItsTurn
    const base = turn < 0 ? pane : turn
    // Only the left pane looks back; the right one stays with the cursor, so the newest
    // photo is always on the wall within a slide of arriving.
    const offset = pane === 0 ? lag : 0
    const item = items[(base + offset) % length]
    if (item !== undefined) panes.push(item)
  }

  return panes
}

/** The crossfade length the room was given, as the custom property the CSS reads. */
const stageStyleFor = (transitionMs: number | null): CSSProperties | StageStyle =>
  transitionMs === null ? {} : { '--wall-transition': `${transitionMs}ms` }

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
 * One of the layouts allowed to crop, because tiles have to tessellate — a host choosing
 * it is choosing that trade. No captions: at six tiles a caption is unreadable from five
 * metres, and unreadable text over a photo is just dirt on the lens. The author stays,
 * because a name is short enough to survive the size.
 *
 * The geometry is fixed in CSS, so a photo arriving mid-evening never reshuffles the
 * wall — it takes a tile's next turn and nothing moves.
 */
function MosaicLayout({ items, slideshow, transitionMs }: LayoutViewProps) {
  const tiles = rotatingSlots(items, slideshow.index, MOSAIC_SLOTS)

  return (
    <div className={styles['mosaic']} style={stageStyleFor(transitionMs)}>
      {tiles.map((item, slot) => (
        <figure
          key={slot}
          className={`${styles['tile']} ${styles[`slot${slot}`]}`}
          // The photo this tile is holding. Same reason as the spotlight's: the tile a
          // mosaic gives a photo is derived from the index alone, and this is what lets
          // two projectors be shown to agree tile for tile.
          data-testid="wall-slide"
          data-photo-id={item.id}
        >
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
          <SlideCaption caption={null} authorName={item.authorName} variant="tile" />
        </figure>
      ))}

      {/* The next tile to turn shows exactly the slideshow's next photo. */}
      <PhotoPreload url={slideshow.next === null ? null : slideshow.next.displayUrl} />
    </div>
  )
}

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
function PolaroidLayout({ items, slideshow, transitionMs }: LayoutViewProps) {
  const reducedMotion = usePrefersReducedMotion()
  const prints = rotatingSlots(items, slideshow.index, POLAROID_PRINTS)

  return (
    <div
      className={styles['polaroid']}
      style={stageStyleFor(transitionMs)}
      data-motion={reducedMotion ? 'still' : 'landing'}
    >
      {prints.map((item, slot) => {
        const tilt: TiltStyle = { '--wall-tilt': `${tiltFor(item.id)}deg` }

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
              <img
                className={styles['printImage']}
                src={item.displayUrl}
                alt={photoAlt(item)}
                width={item.width}
                height={item.height}
                decoding="async"
              />
            </span>
            {/* On the mat, not on the photo: the one caption in the product that is ink
                on paper rather than light over an image. */}
            <SlideCaption caption={item.caption} authorName={item.authorName} variant="print" />
          </figure>
        )
      })}

      <PhotoPreload url={slideshow.next === null ? null : slideshow.next.displayUrl} />
    </div>
  )
}

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
function FilmstripLayout({ items, slideshow, transitionMs }: LayoutViewProps) {
  const reducedMotion = usePrefersReducedMotion()
  const scrolls = items.length > FILMSTRIP_FRAMES
  const frames = playlistWindow(items, scrolls ? slideshow.index : 0, FILMSTRIP_FRAMES + 1)
  const drifts = scrolls && !reducedMotion && slideshow.intervalMs > 0
  const driftStyle: CSSProperties | DriftStyle = drifts
    ? { '--wall-drift-duration': `${slideshow.intervalMs}ms` }
    : {}

  return (
    <div className={styles['filmstrip']} style={stageStyleFor(transitionMs)}>
      <div
        // The index, so the drift restarts in step with the window it is moving.
        key={scrolls ? slideshow.index : 'still'}
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
            <img
              className={styles['frameImage']}
              src={item.displayUrl}
              alt={photoAlt(item)}
              width={item.width}
              height={item.height}
              decoding="async"
            />
          </figure>
        ))}
      </div>

      <PhotoPreload url={slideshow.next === null ? null : slideshow.next.displayUrl} />
    </div>
  )
}

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
function CollageLayout({ items, slideshow, transitionMs }: LayoutViewProps) {
  const composed = rotatingSlots(items, slideshow.index, COLLAGE_CELLS)
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
          <img
            key={item.id}
            className={styles['image']}
            src={item.displayUrl}
            alt={photoAlt(item)}
            width={item.width}
            height={item.height}
            decoding="async"
          />
        </figure>
      ))}

      <PhotoPreload url={slideshow.next === null ? null : slideshow.next.displayUrl} />
    </div>
  )
}

/**
 * Two photos side by side, an older upload beside a newer one.
 *
 * Built for an ultra-wide screen, or two projectors edge-blended, where one letterboxed
 * photo leaves two enormous black bars. Neither pane crops: half of a 21:9 screen is
 * still larger than anything a phone took, so the product promise that nobody's head is
 * cut off survives the split.
 *
 * The panes change alternately, so one half is always still — a wall where both halves
 * cut at once is two slideshows rather than a pairing.
 */
function SplitLayout({ items, slideshow, transitionMs }: LayoutViewProps) {
  const panes = splitPanes(items, slideshow.index)

  return (
    <div className={styles['split']} style={stageStyleFor(transitionMs)}>
      {panes.map((item, pane) => (
        <figure
          key={pane}
          className={styles['pane']}
          data-testid="wall-slide"
          data-photo-id={item.id}
        >
          <span className={styles['paneWindow']}>
            <img
              key={item.id}
              className={styles['paneImage']}
              src={item.displayUrl}
              alt={photoAlt(item)}
              width={item.width}
              height={item.height}
              decoding="async"
            />
          </span>
          <SlideCaption caption={item.caption} authorName={item.authorName} variant="pane" />
        </figure>
      ))}

      <PhotoPreload url={slideshow.next === null ? null : slideshow.next.displayUrl} />
    </div>
  )
}

/**
 * The layout switch.
 *
 * Every name in the contract now renders itself; the `never` assignment below means
 * adding a seventh layout to `WallLayout` fails the build here instead of silently
 * showing the room black.
 */
export function WallLayouts({ layout, ...view }: WallLayoutsProps) {
  switch (layout) {
    case 'spotlight':
      return <SpotlightLayout {...view} />
    case 'mosaic':
      return <MosaicLayout {...view} />
    case 'polaroid':
      return <PolaroidLayout {...view} />
    case 'filmstrip':
      return <FilmstripLayout {...view} />
    case 'collage':
      return <CollageLayout {...view} />
    case 'split':
      return <SplitLayout {...view} />
    default: {
      const unhandled: never = layout
      return unhandled
    }
  }
}
