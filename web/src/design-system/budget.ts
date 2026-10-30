/**
 * What is switched off first when a machine cannot afford the interface — roadmap 11.3.
 *
 * The wall measures itself while it runs, because the only honest frame-rate number is one taken
 * on the machine that has to hold it: **it is not coping — what goes?**
 *
 * ## Why this is a list and not a judgement
 *
 * The roadmap asks for "a written rule for what is switched off first when a device cannot
 * afford it". A rule written down and nowhere else is the shape of defect a mutation audit
 * has already found in this repository more than once, so the order lives here as data,
 * every consequence is derived from it, and `budget.test.ts` is what fails when somebody
 * reorders it.
 *
 * ## The order, and the reason for each step
 *
 * 1. **`ken-burns`.** The wall's slow zoom runs on every frame of every slide. Giving it up
 *    is the largest saving left, and what remains is a photograph held still — which is
 *    what a guest who asked for reduced motion already sees.
 * 2. **`crossfade`.** A second of compositing in every eight. Last, because it is the
 *    cheapest and because a cut is the most noticeable of the three losses.
 *
 * ## What is *not* on the ladder, and will not be
 *
 * The guest's critical path, and every surface that is not the wall. Join, pick, send. Roadmap
 * 11.3's third non-goal is explicit that nothing there may get slower or longer. The ladder
 * used to open with the glass blur, which was the one rung a phone could give up; with the
 * material retired (ADR 0012) a phone has nothing left to shed, so only the wall measures.
 *
 * ## Every rung is a rendering this product already ships
 *
 * That is the argument for doing this automatically at all. Shedding `ken-burns` and `crossfade` lands on exactly what `prefers-reduced-motion`
 * renders, which has committed visual baselines of its own. So a degraded wall is not an
 * unreviewed look — it is a reviewed one, arrived at for a second reason.
 */

/** The order, and the whole of the rule. Everything below is derived from it. */
export const SHED_ORDER = ['ken-burns', 'crossfade'] as const

export type Cost = (typeof SHED_ORDER)[number]

/**
 * How many of `SHED_ORDER` have been given up.
 *
 * A count rather than a name, because the thing that matters about a rung is which side of
 * it a cost falls on, and a count is the only spelling of that which cannot disagree with
 * the order above.
 */
export type BudgetLevel = 0 | 1 | 2

/** Whether a surface at this level still pays for a given cost. */
export const affords = (level: BudgetLevel, cost: Cost): boolean =>
  SHED_ORDER.indexOf(cost) >= level

/** One more rung down, and never past the last one: what is left is the photograph. */
export const shedOne = (level: BudgetLevel): BudgetLevel =>
  level >= SHED_ORDER.length ? level : ((level + 1) as BudgetLevel)

/** What the wall has given up, for the stylesheets that have to know. */
export type WallBudget = 'still' | 'cut'

export interface WallBudgetProps {
  readonly 'data-wall-budget'?: WallBudget
}

/**
 * The marker the wall spreads on its own root.
 *
 * Absent while the wall still has its motion, so that a wall that is coping renders the DOM it rendered before any
 * of this existed, so the committed baselines in `tests/e2e/visual/` stay committed and the
 * default is the undegraded one.
 */
export const wallBudgetProps = (level: BudgetLevel): WallBudgetProps => {
  if (affords(level, 'ken-burns')) return {}
  return { 'data-wall-budget': affords(level, 'crossfade') ? 'still' : 'cut' }
}

/**
 * How many consecutive bad verdicts it takes to give something up.
 *
 * One is a garbage collection, a video keyframe, or the next slide's photograph being
 * decoded. The wall does all three all evening and the room never sees them. Stopping Ken
 * Burns in front of a hundred people because of one of them would be a worse bug than the
 * one this exists to prevent.
 */
export const STRIKES_BEFORE_SHEDDING = 2

export interface BudgetState {
  readonly level: BudgetLevel
  readonly strikes: number
}

/**
 * One verdict, folded in.
 *
 * **One-way.** A good verdict clears the strikes and never gives a rung back. That is a
 * decision and not an omission: what made the frames come back may well be the effect being
 * off, so restoring it invites a wall that oscillates — zoom on, zoom off, zoom on — in
 * front of a room. An evening is a few hours and a reload costs a keystroke.
 */
export const afterVerdict = ({ level, strikes }: BudgetState, held: boolean): BudgetState => {
  if (held) return { level, strikes: 0 }
  if (level >= SHED_ORDER.length) return { level, strikes: 0 }
  const next = strikes + 1
  return next >= STRIKES_BEFORE_SHEDDING
    ? { level: shedOne(level), strikes: 0 }
    : { level, strikes: next }
}

/**
 * How many frames make a window, and why it is this many.
 *
 * About a second and a half at 60 Hz — long enough that one decode cannot dominate it, short
 * enough that two of them fit inside a single slide, so a wall that genuinely cannot cope
 * has given up its zoom before the second photograph rather than after the tenth.
 */
export const FRAME_WINDOW = 90

/**
 * The frame rate below which the room stops seeing motion and starts seeing steps.
 *
 * **This number is measured, and two rules were thrown away getting to it.** The first said
 * "no more than a fifth of a window may come in late", where late meant an interval half
 * again longer than the cadence — a dropped frame. The second said "the wall must deliver
 * more than half the frames its display offered". Both looked reasonable and both were
 * pointed at real walls by `tests/e2e/journeys/frame-budget.spec.ts`, which is what settled
 * it:
 *
 * | The wall under measurement                       | frames/s | dropped | delivered |
 * | ------------------------------------------------ | -------- | ------- | --------- |
 * | As shipped, idle                                 | 56.0     | 8.4%    | 0.92      |
 * | As shipped, six browsers beside it               | 45.2     | 16.3%   | 0.75      |
 * | As shipped, eight                                | 35.7     | 32.1%   | 0.59      |
 * | Every other frame held back                      | 37.0     | 50%     | 0.61      |
 * | Every frame held back 80 ms                      | 12.2     | —       | 1.00      |
 *
 * Read the last three rows together and both discarded rules fall over. A healthy wall on a
 * busy machine drops a third of its frames, so a threshold on dropped frames is a threshold
 * a working room reaches on a busy night. A wall deliberately held to every other frame
 * delivers 0.61 while a healthy contended one delivers 0.59, so the delivered share cannot
 * tell them apart at all — and a machine slowed uniformly delivers 1.00, because when every
 * frame is late none of them is late *relative to the others*.
 *
 * What separates every row cleanly is the plainest number available: **how many frames a
 * second the room actually got.** Healthy walls measured 35.7 to 56.0 and a wall in trouble
 * measured 12.2 to 37.0, so the floor goes at 24 — cinema's, and below every display a
 * venue can plug in, which is what stops a 30 Hz projector over a long HDMI cable being
 * mistaken for a machine that cannot cope.
 */
export const MIN_FRAMES_PER_SECOND = 24

/**
 * The most a single interval may contribute to a window.
 *
 * `requestAnimationFrame` stops firing on a hidden tab, and a laptop lid closed between two
 * courses of a wedding dinner produces one interval of several minutes. That is not a frame
 * anybody waited for, and letting it into the average would degrade a wall that had simply
 * been asleep.
 */
export const STOPPED_PAINTING_MS = 1_000

/**
 * One interval, as it counts — clamped, not discarded.
 *
 * **Discarding was here first and it had the rule backwards.** A gap over the ceiling threw
 * the whole window away, which meant a machine bad enough to stall for more than a second —
 * which is to say the exact machine this feature exists for — never assembled a window at
 * all and therefore never gave anything up. The wall that needed the budget most was the one
 * guaranteed not to get it.
 *
 * Clamping keeps the window and bounds the damage in both directions. A lid closed for ten
 * minutes contributes one second, which a window of ninety frames absorbs without a verdict;
 * a machine that stalls for a second and a half every few seconds contributes a second every
 * time, which drags the average under the floor exactly as it should.
 */
export const frameIntervalOf = (ms: number): number | null =>
  ms > 0 ? Math.min(ms, STOPPED_PAINTING_MS) : null

/** How many frames a second this stretch of intervals actually put on the screen. */
export const frameRateOf = (intervals: readonly number[]): number => {
  const elapsed = intervals.reduce((total, ms) => total + ms, 0)
  if (elapsed === 0) return Number.POSITIVE_INFINITY
  return (1_000 * intervals.length) / elapsed
}

/**
 * Whether a window of frame intervals held.
 *
 * An average over ninety frames rather than a count of bad ones, which is what makes it
 * survive a burst: a single 900 ms stall in an otherwise perfect window still leaves the
 * average at 26 ms, and the wall does stall like that — a photograph decoding, a clip's
 * keyframe, a collection.
 *
 * A window shorter than `FRAME_WINDOW` holds by definition — evidence rather than a guess.
 * Degrading on the three intervals React's first paint produces is the failure mode a short
 * window would have, and it would fire on every machine there is.
 */
export const windowHolds = (intervals: readonly number[]): boolean =>
  intervals.length < FRAME_WINDOW || frameRateOf(intervals) >= MIN_FRAMES_PER_SECOND
