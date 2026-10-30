/**
 * The client's copy of the wall's slide-order rule.
 *
 * **The rule is not decided here.** It is `src/domain/slideshow/slideOrder.ts`, which has
 * the argument, the tests, and the only copy anyone should edit first. `web/` may not import
 * `src/domain` (lint), and the cursor has to move in the browser, because the layout and the
 * photo on screen live there. So everything below the marker line is a verbatim copy, and
 * `src/interface/http/presenters/slideOrderContract.test.ts` fails, naming the first line
 * that differs, when the two drift. Edit both, or neither.
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
  /** Every photo the wall has accounted for: shown, or already in the list when it started. */
  readonly seen: ReadonlySet<string>
  /** How many fresh photos have followed one another. */
  readonly run: number
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

/** A wall that has shown nothing. */
export const EMPTY_CURSOR: SlideCursor = { shown: [], rotationId: null, seen: new Set(), run: 0 }

/** A wall that opens on the newest photo, having already accounted for the whole list. */
export const startCursor = (items: readonly SlideCandidate[]): SlideCursor => {
  const [newest] = items
  if (newest === undefined) return EMPTY_CURSOR
  return {
    shown: [{ id: newest.id, fresh: false }],
    rotationId: newest.id,
    seen: new Set(items.map((item) => item.id)),
    run: 0,
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
 */
export const settleCursor = (
  items: readonly SlideCandidate[],
  cursor: SlideCursor,
): SlideCursor => {
  const [newest] = items
  if (newest === undefined) return cursor

  const ids = new Set(items.map((item) => item.id))
  const head = cursor.shown[0]
  if (head === undefined) return startCursor(items)

  const stale = [...cursor.seen].some((id) => !ids.has(id))
  if (ids.has(head.id) && !stale) return cursor

  const headGone = !ids.has(head.id)
  const seen = new Set([...cursor.seen].filter((id) => ids.has(id)))
  if (headGone) seen.add(newest.id)
  return {
    ...cursor,
    shown: headGone ? [{ id: newest.id, fresh: false }, ...cursor.shown.slice(1)] : cursor.shown,
    rotationId: headGone ? newest.id : cursor.rotationId,
    seen,
  }
}

const show = (cursor: SlideCursor, slide: ShownSlide, rotationId: string | null, run: number) => ({
  slide,
  cursor: {
    shown: [slide, ...cursor.shown].slice(0, MAX_SHOWN),
    rotationId,
    seen: new Set(cursor.seen).add(slide.id),
    run,
  },
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
    return show(cursor, { id: pick.id, fresh: true }, cursor.rotationId, cursor.run + 1)
  }

  const holdoff = Math.min(MAX_SHOWN - 1, items.length - 1)
  const avoid = new Set(cursor.shown.slice(0, holdoff).map((slide) => slide.id))
  const after = items.findIndex((item) => item.id === cursor.rotationId) + 1
  const target = [...items.slice(after), ...items.slice(0, after)].find(
    (item) => !avoid.has(item.id),
  )
  if (target === undefined) return null
  return show(cursor, { id: target.id, fresh: false }, target.id, 0)
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
  return show(cursor, { id: target.id, fresh: false }, target.id, 0)
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
