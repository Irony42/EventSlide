import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { WallItemDto } from '../../../lib/api/dto'
import {
  EMPTY_CURSOR,
  nextSlide,
  settleCursor,
  stepSlide,
  upcomingSlides,
  type Move,
  type SlideCandidate,
  type SlideCursor,
  waitForFirst,
} from './slideOrder'
import { useTimingOverrides } from './useTimingOverrides'

export interface SlideshowOptions {
  readonly items: readonly WallItemDto[]
  /**
   * Milliseconds per slide, from the server. The wall never invents one: the interval
   * and the Ken Burns duration are derived from a single event setting in
   * `src/domain/slideshow/`, and a second opinion here is how 1.0's zoom ended up
   * outliving its slide.
   */
  readonly intervalMs: number
  /**
   * The wall has had its answer. `items` is empty both while the first read is on its way and
   * when the evening has no photo yet, and only the second is news: the first photo to arrive
   * on a wall that was read empty jumps the queue, with its "first photo of" line, where one
   * that arrives on a page still loading is just the list the wall opened on.
   */
  readonly loaded: boolean
}

/** A photo the wall has put on screen lately, and which lane it came from. */
export interface RecentSlide {
  /** `null` when the playlist no longer holds it: it was taken down since. */
  readonly item: WallItemDto | null
  /** It jumped the queue because it had just been published. */
  readonly fresh: boolean
}

export interface Slideshow {
  readonly current: WallItemDto | null
  readonly next: WallItemDto | null
  /** The outgoing photo, kept whole so the crossfade has something to fade out. */
  readonly previous: WallItemDto | null
  readonly index: number
  /**
   * How long the photo on screen will stay there, in milliseconds — the server's
   * interval unless the e2e hook overrode it.
   *
   * Exposed because a layout that animates *across* a slide has to time itself from the
   * same number the slide clock uses. The filmstrip's drift is the case: a drift with
   * its own duration is 1.0's Ken Burns bug in a second place, so there is one value
   * here and no second opinion anywhere else.
   *
   * `0` means **this photo is not going anywhere**, and that has to cover every reason:
   * a one-photo playlist, an interval of zero, and a wall that is paused — by the host's
   * space bar or by a hidden tab. Leaving `paused` out of it was a real defect: the
   * slide timer stopped and the filmstrip went on drifting to the end of its travel,
   * then held there for as long as the wall stayed paused.
   */
  readonly intervalMs: number
  /**
   * How many times the wall has changed photo. Monotonic, so the renderer can hand its
   * two recycled layers a stable slot each (`generation % 2`) instead of reordering
   * them — moving a DOM node restarts its CSS animation, which would jerk the outgoing
   * photo back to its start scale halfway through the crossfade.
   */
  readonly generation: number
  /**
   * What has been on screen, newest first, `recent[0]` being the photo showing now: the
   * last `generation + 1` slides, up to the dozen the biggest layout holds.
   *
   * A layout that holds several photos is made of these, not of positions in the playlist:
   * a photo that has just been published takes the next slide, so slides no longer follow
   * each other in list order, and "the slot whose turn it is takes the photo the wall just
   * moved to" is what keeps one tile changing at a time.
   */
  readonly recent: readonly RecentSlide[]
  /**
   * The slides after this one if nothing new arrives, in order, at most six. What a layout
   * that draws a strip ahead of the photo on screen shows, and what `next` is the head of.
   */
  readonly upcoming: readonly WallItemDto[]
  /** The photo on screen jumped the queue: it was published after the wall started. */
  readonly fresh: boolean
  readonly paused: boolean
  readonly pause: () => void
  readonly resume: () => void
  /** One slide forward by default; the host's left arrow passes `-1`. */
  readonly advance: (step?: number) => void
}

/**
 * Where the wall is, as a photo rather than as a number.
 *
 * 1.0 kept the position as an index in `sessionStorage`, so two projectors on the same
 * event disagreed, and every publication shifted the list under the index — the room
 * saw the picture jump. Here the cursor names the photos on screen — from the first
 * frame, not from the first slide change: when the playlist grows the same photo keeps
 * the screen, and when it leaves the playlist the wall falls back to the newest and
 * anchors itself there.
 *
 * Which photo comes next is `slideOrder.ts`' to say (a copy of
 * `src/domain/slideshow/slideOrder.ts`): this hook holds the cursor and the clock.
 */
interface State {
  readonly slide: SlideCursor
  readonly previous: WallItemDto | null
  readonly generation: number
}

const INITIAL: State = { slide: EMPTY_CURSOR, previous: null, generation: 0 }

/** How far ahead a layout that shows a strip may look. The filmstrip draws six frames. */
const UPCOMING_SLIDES = 6

const subscribeVisibility = (onChange: () => void): (() => void) => {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

const isDocumentHidden = (): boolean => document.hidden

const neverHidden = (): boolean => false

const asCandidate = (item: WallItemDto): SlideCandidate => ({
  id: item.id,
  author: item.authorName,
})

const present = (item: WallItemDto | undefined): item is WallItemDto => item !== undefined

export const useSlideshow = ({ items, intervalMs, loaded }: SlideshowOptions): Slideshow => {
  const [state, setState] = useState<State>(INITIAL)
  const [manuallyPaused, setManuallyPaused] = useState(false)

  /**
   * A hidden tab must not burn through the playlist.
   *
   * A projector that gets minimised for ten minutes would otherwise run four hundred
   * slides with nobody watching, and come back showing a photo from the middle of the
   * evening. `useSyncExternalStore` is how a browser value is read during render
   * without an effect that sets state.
   */
  const documentHidden = useSyncExternalStore(subscribeVisibility, isDocumentHidden, neverHidden)

  const { intervalMs: overrideMs } = useTimingOverrides()
  const effectiveIntervalMs = overrideMs ?? intervalMs

  const candidates = useMemo(() => items.map(asCandidate), [items])
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])

  /**
   * The cursor adopts the photo on screen the moment there is one.
   *
   * On the very first frame, and again after the photo it named was taken down, the
   * cursor names nothing the playlist holds, and slot 0 is the *newest* photo, which
   * moves under the wall every time the host publishes one. A wall that had not changed
   * slide yet was then still positioned by index after all, and a guest's upload took the
   * screen away from whatever the room was looking at: the 1.0 defect, one frame later
   * than 1.0 had it. `settleCursor` also marks the whole list as already seen at that
   * moment, so only photos published afterwards count as new.
   *
   * Adopting is not advancing. The generation is untouched, because nothing moved on
   * screen and bumping it would dissolve a photo into itself across the two layers.
   *
   * Adjusted during render rather than in an effect: React's own guidance for "adjust
   * state when a prop changes" is this comparison, it converges on the next render —
   * `settleCursor` answers the very same object once the cursor is consistent — and
   * `react-hooks/set-state-in-effect` rejects the effect form.
   */
  const slide = settleCursor(
    candidates,
    loaded && candidates.length === 0 ? waitForFirst(state.slide) : state.slide,
  )
  if (slide !== state.slide) {
    setState({ ...state, slide })
  }

  const head = slide.shown[0]
  const current = head === undefined ? null : (byId.get(head.id) ?? null)
  const index =
    head === undefined
      ? 0
      : Math.max(
          0,
          items.findIndex((item) => item.id === head.id),
        )

  const upcoming = useMemo(
    () =>
      upcomingSlides(candidates, slide, UPCOMING_SLIDES)
        .map((ahead) => byId.get(ahead.id))
        .filter(present),
    [candidates, byId, slide],
  )
  const next = upcoming[0] ?? null

  const recent = useMemo<readonly RecentSlide[]>(
    () => slide.shown.map((shown) => ({ item: byId.get(shown.id) ?? null, fresh: shown.fresh })),
    [slide, byId],
  )

  const move = useCallback(
    (choose: (list: readonly SlideCandidate[], cursor: SlideCursor) => Move | null) => {
      setState((previousState) => {
        const settled = settleCursor(candidates, previousState.slide)
        const moved = choose(candidates, settled)
        if (moved === null) return previousState
        const leaving = settled.shown[0]?.id
        // Standing still is not a change: a one-photo wall must not keep bumping the
        // generation, or the two layers would swap slots with nothing to show.
        if (moved.slide.id === leaving) return previousState
        return {
          slide: moved.cursor,
          previous:
            (leaving === undefined ? undefined : byId.get(leaving)) ?? previousState.previous,
          generation: previousState.generation + 1,
        }
      })
    },
    [candidates, byId],
  )

  /** The host's arrows: exactly the photo that many places away. */
  const advance = useCallback(
    (step = 1) => move((list, cursor) => stepSlide(list, cursor, step)),
    [move],
  )

  /** The slide clock: the fresh lane and the rotation, by the rule. */
  const advanceAutomatically = useCallback(() => move(nextSlide), [move])

  /**
   * The timer calls the latest step through a ref.
   *
   * The step is rebuilt whenever the playlist changes, and a busy cocktail hour
   * changes it every few seconds. If the interval depended on it, each publication
   * would restart the slide clock and a photo would keep being granted a fresh eight
   * seconds — on a fast enough event, the wall would never advance at all.
   */
  const advanceRef = useRef(advanceAutomatically)
  useEffect(() => {
    advanceRef.current = advanceAutomatically
  }, [advanceAutomatically])

  const paused = manuallyPaused || documentHidden
  const canAdvance = items.length > 1 && effectiveIntervalMs > 0
  const currentId = current?.id ?? null

  useEffect(() => {
    if (paused || !canAdvance || currentId === null) return

    const timer = window.setTimeout(() => advanceRef.current(), effectiveIntervalMs)
    // Cleared on every re-run and on unmount. An eight-hour run that leaked one timer
    // per slide would end the evening with three thousand of them.
    return () => window.clearTimeout(timer)
  }, [paused, canAdvance, effectiveIntervalMs, currentId])

  const pause = useCallback(() => setManuallyPaused(true), [])
  const resume = useCallback(() => setManuallyPaused(false), [])

  return {
    current,
    next,
    previous: state.previous,
    index,
    // Exactly the condition the slide timer below arms itself on, and for the same
    // reason: a layout timing itself off the server's number would drift apart from the
    // wall under the e2e hooks, and one that ignored `paused` would go on animating
    // after the host had stopped the show.
    intervalMs: !paused && canAdvance ? effectiveIntervalMs : 0,
    generation: state.generation,
    recent,
    upcoming,
    fresh: head?.fresh ?? false,
    paused,
    pause,
    resume,
    advance,
  }
}
