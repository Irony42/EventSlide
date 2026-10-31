/**
 * Which photo the wall shows next.
 *
 * `buildPlaylist` says which photos are in rotation and in what order. This says where the
 * wall goes from the photo on screen. 1.0 and 3.x walked the list one step at a time towards
 * older photos, so a photo the host had just published, which the playlist puts first,
 * waited a whole lap to be reached: about 26 minutes at 200 photos and 8 seconds a slide.
 * The guest who sent it had long since stopped looking up.
 *
 * The rule has two lanes:
 *
 * - **Fresh.** A photo the wall has not accounted for yet takes the very next slide, never
 *   the one on screen. At most {@link MAX_FRESH_RUN} follow one another, then one photo of
 *   the rotation goes by, so a burst of thirty photos from one table cannot own the screen.
 *   Among the waiting photos the oldest goes first (arrival order), skipping the author who
 *   is on screen when someone else is waiting, so a burst interleaves with the others.
 * - **Rotation.** The usual walk towards older photos, resuming from the last photo the
 *   rotation itself showed, and skipping what was shown in the last few slides so a short
 *   playlist does not put one face on the wall twice.
 *
 * It is pure: the same list and the same cursor give the same answer (trap 7 in CLAUDE.md).
 * Where a wall *is* belongs to its cursor, and a wall that starts later simply starts with a
 * cursor that has already seen the whole list. Walls with different histories are not the
 * same wall: they differ at most by the fresh lane, which photos each of them has accounted
 * for, and then re-converge.
 * The one exception is a wall that was *read empty*: the evening has not started, so its first
 * photos are news and open the wall fresh (`waitForFirst`), where a page load on a populated
 * wall opens on its newest photo and says nothing.
 *
 * **The web client carries a copy of everything below the marker line.** `web/` may not
 * import `src/domain`, so `web/src/features/wall/hooks/slideOrder.ts` holds the same text
 * and `src/interface/http/presenters/slideOrderContract.test.ts` fails when the two differ.
 * Edit both, or neither.
 */

// ----------------------------------------------------------------- shared body --

/** What the rule needs to know about a photo. The author is `null` for an anonymous one. */
export interface SlideCandidate {
  readonly id: string
  readonly author: string | null
}

export interface ShownSlide {
  readonly id: string
  /** It came from the fresh lane and not from the rotation. */
  readonly fresh: boolean
}

export interface SlideCursor {
  /** What has been on screen, newest first. `shown[0]` is the photo on screen now. */
  readonly shown: readonly ShownSlide[]
  /** The last photo the rotation put on screen: where it resumes after a fresh run. */
  readonly rotationId: string | null
  /**
   * The photos that followed `rotationId` in the list when it was set, nearest first and
   * at most {@link MAX_SHOWN}. If the host hides `rotationId` while it is not on screen
   * (during a fresh run), this is how the rotation knows where it was: it continues with the
   * nearest of these that is still in the list, instead of going back to the newest photo.
   */
  readonly ahead: readonly string[]
  /** Every photo the wall has accounted for: shown, or already in the list when it started. */
  readonly seen: ReadonlySet<string>
  /** How many fresh photos have followed one another. */
  readonly run: number
  /**
   * The wall read a list with nothing in it and has shown nothing since: whatever arrives
   * first is the evening's first photo, not part of a list the wall opened on.
   */
  readonly awaitingFirst: boolean
}

export interface Move {
  readonly slide: ShownSlide
  readonly cursor: SlideCursor
}

/** Fresh photos in a row before one photo of the rotation. */
export const MAX_FRESH_RUN = 3

/**
 * How many past slides a cursor remembers: the most photos any layout holds at once (the
 * collage's twelve cells), because a multi-slot layout is made of the last few slides.
 */
export const MAX_SHOWN = 12

const wrap = (position: number, length: number): number => ((position % length) + length) % length

/** The ids that follow `id` in the list, nearest first; the whole head of the list for `null`. */
const photosAfter = (items: readonly SlideCandidate[], id: string | null): readonly string[] => {
  const from = items.findIndex((item) => item.id === id) + 1
  return items.slice(from, from + MAX_SHOWN).map((item) => item.id)
}

/** A wall that has shown nothing. */
export const EMPTY_CURSOR: SlideCursor = {
  shown: [],
  rotationId: null,
  ahead: [],
  seen: new Set(),
  run: 0,
  awaitingFirst: false,
}

/** A wall that has read an empty list: its first photos are news, however they arrive. */
export const WAITING_CURSOR: SlideCursor = { ...EMPTY_CURSOR, awaitingFirst: true }

/**
 * The cursor for a wall that has just read a list with nothing in it.
 *
 * Only a wall that has shown nothing waits: one that already has a photo on screen keeps
 * its cursor, so a list that empties and refills is settled as it always was. The caller
 * says "read" because `[]` is also what a wall holds while it has not been answered yet,
 * and a page load on a populated wall must open on its newest photo, not announce it.
 */
export const waitForFirst = (cursor: SlideCursor): SlideCursor =>
  cursor.shown.length === 0 && !cursor.awaitingFirst ? WAITING_CURSOR : cursor

/** A wall that opens on the newest photo, having already accounted for the whole list. */
export const startCursor = (items: readonly SlideCandidate[]): SlideCursor => {
  const [newest] = items
  if (newest === undefined) return EMPTY_CURSOR
  return {
    shown: [{ id: newest.id, fresh: false }],
    rotationId: newest.id,
    ahead: photosAfter(items, newest.id),
    seen: new Set(items.map((item) => item.id)),
    run: 0,
    awaitingFirst: false,
  }
}

/**
 * A wall that was empty and has its first photos: the oldest arrival is on screen, fresh,
 * and the others wait their turn in the fresh lane. This is what puts "first photo of" under
 * the photo that opens an evening, the moment a guest and their table are looking.
 */
const openOnArrivals = (items: readonly SlideCandidate[]): SlideCursor => {
  // The list is newest first, so the last one is the first to have arrived.
  const first = items[items.length - 1]
  if (first === undefined) return EMPTY_CURSOR
  return {
    shown: [{ id: first.id, fresh: true }],
    rotationId: null,
    ahead: [],
    seen: new Set([first.id]),
    run: 1,
    awaitingFirst: false,
  }
}

/**
 * The cursor made consistent with the list it now reads, or the very same object when it
 * already is.
 *
 * A photo that left the list while on screen (rejected, hidden, deleted) is replaced by the
 * newest, which is the one a guest just sent. Photos that left the list are forgotten, so
 * one the host hides and publishes again counts as new, and the memory cannot outgrow the
 * window.
 *
 * The photo the rotation last showed can leave the list while it is not on screen, during a
 * run of fresh photos. The rotation then carries on from the nearest photo that followed it
 * and survives, towards older photos, and not from the newest: a wall that went back to the
 * top of the list would show the photos of the last hour again before the ones it had not
 * reached.
 */
export const settleCursor = (
  items: readonly SlideCandidate[],
  cursor: SlideCursor,
): SlideCursor => {
  const [newest] = items
  if (newest === undefined) return cursor

  const ids = new Set(items.map((item) => item.id))
  const head = cursor.shown[0]
  if (head === undefined) return cursor.awaitingFirst ? openOnArrivals(items) : startCursor(items)

  const stale = [...cursor.seen].some((id) => !ids.has(id))
  const rotationGone = cursor.rotationId !== null && !ids.has(cursor.rotationId)
  if (ids.has(head.id) && !stale && !rotationGone) return cursor

  const headGone = !ids.has(head.id)
  const seen = new Set([...cursor.seen].filter((id) => ids.has(id)))
  if (headGone) seen.add(newest.id)

  let rotationId = cursor.rotationId
  if (headGone) {
    rotationId = newest.id
  } else if (rotationGone) {
    // The rotation resumes *at* the survivor, and it steps to the photo after `rotationId`:
    // so `rotationId` becomes the photo just newer than the survivor, or `null` (the top of
    // the list) when the survivor is the newest or nothing that followed is left.
    const survivor = cursor.ahead.find((id) => ids.has(id))
    const at = survivor === undefined ? -1 : items.findIndex((item) => item.id === survivor)
    rotationId = items[at - 1]?.id ?? null
  }
  return {
    ...cursor,
    shown: headGone ? [{ id: newest.id, fresh: false }, ...cursor.shown.slice(1)] : cursor.shown,
    rotationId,
    ahead: rotationId === cursor.rotationId ? cursor.ahead : photosAfter(items, rotationId),
    seen,
  }
}

const show = (
  cursor: SlideCursor,
  slide: ShownSlide,
  rotation: { readonly id: string | null; readonly ahead: readonly string[] },
  run: number,
) => ({
  slide,
  cursor: {
    shown: [slide, ...cursor.shown].slice(0, MAX_SHOWN),
    rotationId: rotation.id,
    ahead: rotation.ahead,
    seen: new Set(cursor.seen).add(slide.id),
    run,
    awaitingFirst: false,
  },
})

/** The rotation's position after it shows `id`. */
const rotatedTo = (items: readonly SlideCandidate[], id: string) => ({
  id,
  ahead: photosAfter(items, id),
})

/**
 * The automatic step: the next slide by the rule above, or `null` for an empty list.
 *
 * With one photo it answers that photo, and the caller treats standing still as no change.
 */
export const nextSlide = (items: readonly SlideCandidate[], cursor: SlideCursor): Move | null => {
  const current = cursor.shown[0]
  // The list is newest first, so reversed it is arrival order.
  const waiting = items.filter((item) => !cursor.seen.has(item.id) && item.id !== current?.id)
  waiting.reverse()

  const [oldest] = waiting
  if (oldest !== undefined && cursor.run < MAX_FRESH_RUN) {
    const onScreen = items.find((item) => item.id === current?.id)
    const pick = waiting.find((item) => item.author !== onScreen?.author) ?? oldest
    // The fresh lane does not move the rotation.
    const rotation = { id: cursor.rotationId, ahead: cursor.ahead }
    return show(cursor, { id: pick.id, fresh: true }, rotation, cursor.run + 1)
  }

  const holdoff = Math.min(MAX_SHOWN - 1, items.length - 1)
  const avoid = new Set(cursor.shown.slice(0, holdoff).map((slide) => slide.id))
  const after = items.findIndex((item) => item.id === cursor.rotationId) + 1
  const target = [...items.slice(after), ...items.slice(0, after)].find(
    (item) => !avoid.has(item.id),
  )
  if (target === undefined) return null
  return show(cursor, { id: target.id, fresh: false }, rotatedTo(items, target.id), 0)
}

/**
 * The host's own step, by `step` places in the list from the photo on screen. It ignores
 * the fresh lane: a person pressing an arrow means "that one", and `-1` has to undo `+1`.
 */
export const stepSlide = (
  items: readonly SlideCandidate[],
  cursor: SlideCursor,
  step: number,
): Move | null => {
  const from = items.findIndex((item) => item.id === cursor.shown[0]?.id)
  const target = items[wrap(Math.max(from, 0) + step, items.length)]
  if (target === undefined) return null
  return show(cursor, { id: target.id, fresh: false }, rotatedTo(items, target.id), 0)
}

/** The next `count` slides if nothing new arrives, for what a layout shows ahead of time. */
export const upcomingSlides = (
  items: readonly SlideCandidate[],
  cursor: SlideCursor,
  count: number,
): readonly ShownSlide[] => {
  const slides: ShownSlide[] = []
  let ahead = cursor
  for (let step = 0; step < count; step += 1) {
    const move = nextSlide(items, ahead)
    if (move === null) break
    slides.push(move.slide)
    ahead = move.cursor
  }
  return slides
}
