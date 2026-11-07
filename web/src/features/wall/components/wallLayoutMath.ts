import type { WallItemDto } from '../../../lib/api/dto'
import type { Slideshow } from '../hooks/useSlideshow'

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
export const MOSAIC_SLOTS = 6
export const POLAROID_PRINTS = 3
export const FILMSTRIP_FRAMES = 5
export const COLLAGE_CELLS = 12
export const SPLIT_PANES = 2
export const CLOTHESLINE_PRINTS = 5

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
export const rotatingSlots = (
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
export const playlistWindow = (
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

export const tiltFor = (photoId: string): number => {
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
export const splitPanes = (
  items: readonly WallItemDto[],
  slideshow: Pick<Slideshow, 'recent' | 'generation'>,
): readonly WallItemDto[] => {
  const length = items.length
  if (length === 0) return []

  const { recent, generation } = slideshow
  const visible = Math.min(SPLIT_PANES, length)
  const lag = splitLag(length)
  const wanted: { readonly position: number; readonly fresh: boolean }[] = []

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
    wanted.push({ position: (base + offset) % length, fresh: slide?.fresh === true })
  }

  // Two panes may ask for the same photo: the left pane's look back lands on the very photo
  // the right pane took on its own turn, typically one that has just been published. The
  // same face in both halves reads as a fault, so the pane that has the stronger claim
  // keeps it - a photo that jumped the queue first, then the right pane, which stays with
  // the wall - and the other takes the next position of the playlist that is not up.
  const claimed = new Set<number>()
  const resolved: number[] = []
  const freshness = (pane: number): number => (wanted[pane]?.fresh === true ? 1 : 0)
  const byClaim = wanted.map((_, pane) => pane).sort((a, b) => freshness(b) - freshness(a) || b - a)
  for (const pane of byClaim) {
    let position = wanted[pane]?.position ?? pane
    // `visible` never exceeds the playlist, so fewer than `length` positions are claimed
    // here and the walk ends.
    while (claimed.has(position)) position = (position + 1) % length
    claimed.add(position)
    resolved[pane] = position
  }

  return resolved.flatMap((position) => {
    const item = items[position]
    return item === undefined ? [] : [item]
  })
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

export const newestOf = (items: readonly WallItemDto[]): string | null => {
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
export const saysFirstPhoto = (
  item: WallItemDto,
  slideshow: Pick<Slideshow, 'current' | 'fresh'>,
) => slideshow.fresh && slideshow.current?.id === item.id && item.firstFromGuest === true

/** The URL to preload for the slideshow's next photograph, or `null` when there is none. */
export const nextPhotoUrl = (slideshow: Pick<Slideshow, 'next'>): string | null =>
  slideshow.next?.displayUrl ?? null
