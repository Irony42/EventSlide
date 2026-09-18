import { useEffect, useRef, useState } from 'react'
import {
  afterVerdict,
  affords,
  budgetFloorFor,
  FRAME_WINDOW,
  frameIntervalOf,
  windowHolds,
  type BudgetLevel,
  type BudgetState,
} from '../../../design-system/budget'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'

/**
 * The wall measuring whether it is actually holding its frames — roadmap 11.3.
 *
 * ## Why this exists at all, when §13 said the claim was reasoned rather than measured
 *
 * It said so because the only honest frame-rate number is one taken on the machine that
 * has to hold it, and no test in this repository runs on a venue mini-PC driving a
 * projector. That argument is still true, and this is the conclusion it actually leads to:
 * if the number can only be taken on the night, then the thing that takes it has to ship —
 * **the machine measures itself, and the decision written down in `budget.ts` is the one it
 * takes.** §13's "human check" is a person with DevTools open watching a dropped-frame
 * counter through ten slide changes. This is that person, on every wall, all evening.
 *
 * ## What it measures, and why it is the plainest number available
 *
 * Intervals between paints, in windows of `FRAME_WINDOW`, judged on how many frames a second
 * they add up to against `MIN_FRAMES_PER_SECOND`. `budget.ts` carries the measurements and
 * the two cleverer rules they killed — a count of dropped frames, and the share of the
 * display's own frames the wall delivered — both of which turned out to be unable to
 * separate a healthy wall on a busy machine from a wall in real trouble. An average over
 * ninety frames also survives the stall a wall genuinely does produce all evening: a
 * photograph decoding, a clip's keyframe, a collection.
 *
 * The floor is absolute rather than relative to the display, and 24 is low enough that it
 * can be: a venue mini-PC may drive a projector at 60 Hz, at 50 or at 30 over a long cable,
 * and every one of those is comfortably above it, so no display is ever mistaken for a
 * machine that cannot cope.
 *
 * ## What it costs, which matters because of what it is for
 *
 * One `requestAnimationFrame` callback pushing a number into an array, on a surface that
 * is already painting every frame; the window is evaluated once per ninety frames, and a
 * React render happens **only when a rung changes** — at most twice in an evening — rather
 * than once per window, which over eight hours would be twenty thousand reconciliations of
 * the wall on the machine this is supposed to protect. The loop is torn down for good at
 * the bottom of the ladder, because a measurement that can no longer change anything is
 * pure cost.
 *
 * ## What it deliberately does not do
 *
 * Climb back. `afterVerdict` is one-way, and the reason is in `budget.ts`: the thing that
 * made the frames come back is very likely the effect being off, so restoring it invites a
 * wall that oscillates in front of a room.
 *
 * And it does not run at all for a viewer who asked for no motion. Ken Burns is never
 * declared for them and `base.css` has already collapsed the crossfade, so both rungs below
 * the room's floor are already spent: a loop there could only take something away from a
 * wall that was not spending it. The preference is read here rather than passed in so that
 * `WallPage` stays a component that does not know the query exists — which is what
 * `motion.budget.test.ts` records about it.
 */
export const useFrameBudget = (): BudgetLevel => {
  const reducedMotion = usePrefersReducedMotion()
  const floor = budgetFloorFor('wall')
  const [level, setLevel] = useState<BudgetLevel>(floor)

  /**
   * Strikes live outside React on purpose.
   *
   * They change every window and decide nothing on their own; only a rung reaches the DOM.
   * Holding them in state would be the re-render this hook exists to avoid.
   */
  const state = useRef<BudgetState>({ level: floor, strikes: 0 })

  // The bottom of the ladder: `crossfade` is the last thing there is to give up, so a wall
  // that has already given it up has nothing left to measure for.
  const spent = !affords(level, 'crossfade')

  useEffect(() => {
    if (reducedMotion || spent) return undefined

    let handle = 0
    let previousPaint: number | null = null
    let intervals: number[] = []

    const onPaint = (now: number): void => {
      handle = requestAnimationFrame(onPaint)

      if (previousPaint !== null) {
        // Clamped rather than dropped, and the window is kept either way: a wall that stalls
        // past the ceiling often enough to lose its windows is the wall that most needs a
        // verdict. `budget.ts` has the argument.
        const interval = frameIntervalOf(now - previousPaint)
        if (interval !== null) intervals.push(interval)
      }
      previousPaint = now

      if (intervals.length < FRAME_WINDOW) return

      const held = windowHolds(intervals)
      intervals = []

      const before = state.current.level
      state.current = afterVerdict(state.current, held)
      if (state.current.level !== before) setLevel(state.current.level)
    }

    handle = requestAnimationFrame(onPaint)
    return () => cancelAnimationFrame(handle)
  }, [reducedMotion, spent])

  return level
}
