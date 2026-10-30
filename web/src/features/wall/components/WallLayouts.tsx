import type { CSSProperties } from 'react'
import { cx } from '../../../design-system/classNames'
import type { WallItemDto, WallLayout } from '../../../lib/api/dto'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import type { Slideshow } from '../hooks/useSlideshow'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { photoAlt } from '../../../lib/photoAlt'
import { wallLayoutPlaysVideo } from '../wallLayoutPlayback'
import { PhotoPreload } from './PhotoPreload'
import { SlideCaption } from './SlideCaption'
import { SlideLayer } from './SlideLayer'
import { WallMedia } from './WallMedia'
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
  /**
   * Whether a clip in this layout plays or shows its poster frame.
   *
   * Resolved once, in {@link WallLayouts}, from the layout's spec — see
   * `wallLayoutPlayback.ts` and `src/domain/slideshow/wallLayout.ts`. Every layout below
   * takes it and hands it to {@link WallMedia}; none of them decides it, and a layout
   * that hardcoded `false` would be the domain's rule written a second time, in the place
   * it is hardest to find.
   */
  readonly plays: boolean
}

export interface WallLayoutsProps extends Omit<LayoutViewProps, 'plays'> {
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
const CLOTHESLINE_PRINTS = 5

/**
 * Which photos a rotating layout is holding right now.
 *
 * One slot changes per slide, in turn, rather than all of them at once: a whole-wall
 * refresh every eight seconds reads as a fault from across the room, and it is what
 * gives each photo `slotCount` slides on screen — the reason a host picks a multi-slot
 * layout for a busy cocktail hour in the first place. The slot whose turn it is takes the
 * photo the wall has just moved to, which is `slideshow.recent[0]`; the others keep what
 * they took on their own earlier turns, `recent[1]` and so on. So a photo that has just
 * been published and jumps the queue goes into the next slot to turn, wherever it sits in
 * the playlist. Derived purely from the slideshow's history and its generation, so two
 * projectors that have shown the same slides agree slot for slot.
 *
 * A slot whose photo has since been taken down, or that a short playlist would hang twice,
 * takes the newest photo that is not already up: a host's "remove from the screen" has to
 * be prompt in every layout, not only the spotlight.
 *
 * The result is as short as the playlist when the playlist is shorter than the grid.
 * Repeating a photo to fill the holes was the alternative and it is worse: the same face
 * twice on one wall reads as a fault, and the moment it would happen is ten minutes
 * after the doors open, when the host is watching the screen hardest.
 */
const rotatingSlots = (
  items: readonly WallItemDto[],
  slideshow: Pick<Slideshow, 'recent' | 'generation'>,
  slotCount: number,
): readonly WallItemDto[] => {
  const visible = Math.min(slotCount, items.length)
  const { recent, generation } = slideshow
  // The turn cycle is as long as what is on the wall. With fewer photos than slots, a cycle
  // of `slotCount` and a playlist of another length put one photo in two slots at once.
  const cycle = visible

  const claimed = new Set<string>()
  const held: (WallItemDto | undefined)[] = []
  for (let slot = 0; slot < visible; slot += 1) {
    const sinceItsTurn = (((generation - slot) % cycle) + cycle) % cycle
    // Before a slot's first turn it simply shows the photo at its own position, so the
    // wall is full from the first frame instead of filling in over a minute.
    const item =
      generation - sinceItsTurn < 0 ? items[slot] : (recent[sinceItsTurn]?.item ?? undefined)
    if (item === undefined || claimed.has(item.id)) {
      held.push(undefined)
    } else {
      claimed.add(item.id)
      held.push(item)
    }
  }

  return held.flatMap((item) => {
    if (item !== undefined) return [item]
    // `visible` never exceeds the playlist and fewer than `visible` ids are claimed
    // here, so there is always one left. The `undefined` branch is the narrowing
    // `noUncheckedIndexedAccess` asks for and not a fallback to invent a photo with.
    const spare = items.find((candidate) => !claimed.has(candidate.id))
    if (spare === undefined) return []
    claimed.add(spare.id)
    return [spare]
  })
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
 * The two halves of the split, right now.
 *
 * The panes take their turn alternately — the same derivation the mosaic uses, with two
 * slots — so one half is always stable while the other changes. A wall where both halves
 * cut at once is two slideshows, not a pairing, and there is nothing left for the eye to
 * rest on.
 *
 * The left pane's turn is a look back, so it does not show the photo the wall moved to but
 * one half a playlist older. Except for a photo that has just been published and jumped the
 * queue: that one is shown as it is, on whichever pane's turn it takes, because "look up,
 * it is on the screen" must not depend on a pane's parity.
 */
const splitPanes = (
  items: readonly WallItemDto[],
  slideshow: Pick<Slideshow, 'recent' | 'generation'>,
): readonly WallItemDto[] => {
  const length = items.length
  if (length === 0) return []

  const { recent, generation } = slideshow
  const visible = Math.min(SPLIT_PANES, length)
  const lag = splitLag(length)
  const panes: WallItemDto[] = []

  for (let pane = 0; pane < visible; pane += 1) {
    const sinceItsTurn = (((generation - pane) % SPLIT_PANES) + SPLIT_PANES) % SPLIT_PANES
    const turn = generation - sinceItsTurn
    const slide = turn < 0 ? undefined : recent[sinceItsTurn]
    const shown = slide?.item ?? undefined
    // Where the pane's photo sits in the playlist: the slide's own, or the pane's position
    // before its first turn (and when the slide has since been taken down).
    const found = shown === undefined ? -1 : items.findIndex((item) => item.id === shown.id)
    const base = found === -1 ? pane : found
    // Only the left pane looks back; the right one stays with the wall, so the newest
    // photo is always on the screen within a slide of arriving.
    const offset = pane === 0 && slide?.fresh !== true ? lag : 0
    const item = items[(base + offset) % length]
    if (item !== undefined) panes.push(item)
  }

  return panes
}

/**
 * The photo on the line that arrived last, or `null` when there is none.
 *
 * "Newest" is the upload's own timestamp and not the playlist's order, so the answer is
 * the same whichever slot a photo happens to hang in, and the same on two projectors. A
 * tie keeps the earlier print, and a timestamp that does not parse loses to one that does:
 * deterministic, and the only way a wall with nothing to compare could have chosen.
 */
/** An upload's time, with one that does not parse sorting before every one that does. */
const stampOf = (item: WallItemDto): number => {
  const stamp = Date.parse(item.createdAt)
  return Number.isNaN(stamp) ? Number.NEGATIVE_INFINITY : stamp
}

const newestOf = (items: readonly WallItemDto[]): string | null => {
  let newest: WallItemDto | null = null
  for (const item of items) {
    if (newest === null || stampOf(item) > stampOf(newest)) {
      newest = item
    }
  }
  return newest === null ? null : newest.id
}

/**
 * Whether the line "first photo of …" goes under this photo, now.
 *
 * Said the first time the photo comes up, which is the moment the guest and their table are
 * looking: the photo the wall has just moved to, and only while it is the fresh lane's. Said
 * again at every lap, it would sit under a photo for the whole evening, and a hundred
 * guests' first photos would all carry it. In a layout that holds several photos it is the
 * one the slide clock just brought in, not whichever print happens to be a first photo too.
 */
const saysFirstPhoto = (item: WallItemDto, slideshow: Pick<Slideshow, 'current' | 'fresh'>) =>
  slideshow.fresh && slideshow.current?.id === item.id && item.firstFromGuest === true

/** The crossfade length the room was given, as the custom property the CSS reads. */
const stageStyleFor = (transitionMs: number | null): CSSProperties | StageStyle =>
  transitionMs === null ? {} : { '--wall-transition': `${transitionMs}ms` }

/** One photo, letterboxed, with its caption and author. The safe default. */
function SpotlightLayout({ slideshow, kenBurnsDurationMs, transitionMs, plays }: LayoutViewProps) {
  const { current, previous, next, generation } = slideshow

  return (
    <SlideLayer
      current={current}
      previous={previous}
      next={next}
      kenBurnsDurationMs={kenBurnsDurationMs}
      transitionMs={transitionMs}
      // The slideshow's own cadence, never the server's: a zoom timed off a number the
      // wall is not actually running on is the second opinion trap 6 is about. `0` is a
      // wall that is not going to change photo, and it gets a photograph at rest.
      advancing={slideshow.intervalMs > 0}
      generation={generation}
      plays={plays}
      caption={
        current === null ? null : (
          <SlideCaption
            caption={current.caption}
            authorName={current.authorName}
            firstFromGuest={saysFirstPhoto(current, slideshow)}
          />
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
function MosaicLayout({ items, slideshow, transitionMs, plays }: LayoutViewProps) {
  const text = useTranslations()
  const tiles = rotatingSlots(items, slideshow, MOSAIC_SLOTS)

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
        >
          <WallMedia
            // Keyed by the photo, so a tile taking its turn fades its new photo in
            // rather than swapping it under the viewer's eye.
            key={item.id}
            item={item}
            plays={plays}
            alt={photoAlt(item, text)}
            className={styles['image']}
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
function PolaroidLayout({ items, slideshow, transitionMs, plays }: LayoutViewProps) {
  const text = useTranslations()
  const reducedMotion = usePrefersReducedMotion()
  const prints = rotatingSlots(items, slideshow, POLAROID_PRINTS)

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
              firstFromGuest={saysFirstPhoto(item, slideshow)}
              variant="print"
            />
          </figure>
        )
      })}

      <PhotoPreload url={slideshow.next === null ? null : slideshow.next.displayUrl} />
    </div>
  )
}

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
function ClotheslineLayout({ items, slideshow, transitionMs, plays }: LayoutViewProps) {
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
          const tilt: TiltStyle = { '--wall-tilt': `${tiltFor(item.id)}deg` }

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
                firstFromGuest={saysFirstPhoto(item, slideshow)}
                variant="print"
              />
            </figure>
          )
        })}
      </div>

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
function FilmstripLayout({ items, slideshow, transitionMs, plays }: LayoutViewProps) {
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
function CollageLayout({ items, slideshow, transitionMs, plays }: LayoutViewProps) {
  const text = useTranslations()
  const composed = rotatingSlots(items, slideshow, COLLAGE_CELLS)
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
function SplitLayout({ items, slideshow, transitionMs, plays }: LayoutViewProps) {
  const text = useTranslations()
  const panes = splitPanes(items, slideshow)

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
            <WallMedia
              key={item.id}
              item={item}
              plays={plays}
              alt={photoAlt(item, text)}
              className={styles['paneImage']}
            />
          </span>
          <SlideCaption
            caption={item.caption}
            authorName={item.authorName}
            firstFromGuest={saysFirstPhoto(item, slideshow)}
            variant="pane"
          />
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
 * adding another layout to `WallLayout` fails the build here instead of silently
 * showing the room black.
 *
 * It is also the **one** place that asks whether this layout plays video. Resolved here
 * and handed down, so the answer is the domain's spec at every slot on the wall rather
 * than six components each remembering the same rule — and so a seventh layout gets its
 * answer from the spec too, automatically, instead of from whichever branch somebody
 * copied.
 */
export function WallLayouts({ layout, ...view }: WallLayoutsProps) {
  const plays = wallLayoutPlaysVideo(layout)

  switch (layout) {
    case 'spotlight':
      return <SpotlightLayout {...view} plays={plays} />
    case 'mosaic':
      return <MosaicLayout {...view} plays={plays} />
    case 'polaroid':
      return <PolaroidLayout {...view} plays={plays} />
    case 'filmstrip':
      return <FilmstripLayout {...view} plays={plays} />
    case 'collage':
      return <CollageLayout {...view} plays={plays} />
    case 'split':
      return <SplitLayout {...view} plays={plays} />
    case 'clothesline':
      return <ClotheslineLayout {...view} plays={plays} />
    default: {
      const unhandled: never = layout
      return unhandled
    }
  }
}
