import type { GlassSurface } from './glass'

/**
 * What is switched off first when a machine cannot afford the interface — roadmap 11.3.
 *
 * `glass.ts` answers "what does the material cost on this surface" and "what can be painted
 * underneath it". Both of those are answered before anything renders. This file answers the
 * third question, the one that can only be answered by the machine actually running the
 * thing: **it is not coping — what goes?**
 *
 * ## Why this is a list and not a judgement
 *
 * The roadmap asks for "a written rule for what is switched off first when a device cannot
 * afford it". A rule written down and nowhere else is the shape of defect a mutation audit
 * has already found in this repository more than once, so the order lives here as data,
 * every consequence is derived from it, and `budget.test.ts` is what fails when somebody
 * reorders it. There is one ladder rather than one per audience, because "the wall gets the
 * opaque fallback and the guest keeps the blur" is the *same* rule seen from two surfaces:
 * both give up glass first, and the wall simply starts already having given it up.
 *
 * ## The order, and the reason for each step
 *
 * 1. **`glass`.** The blur is the only thing here that is decoration. It is also the most
 *    expensive per pixel — a `backdrop-filter` over content that changes is recomputed
 *    every frame at the pane's full size — and the fallback is a surface this product
 *    already ships everywhere else (§13: `--glass-opaque` *is* `--surface-raised`). First,
 *    on every surface, without argument.
 * 2. **`ken-burns`.** The wall's slow zoom runs on every frame of every slide. Giving it up
 *    is the largest saving left, and what remains is a photograph held still — which is
 *    what a guest who asked for reduced motion already sees.
 * 3. **`crossfade`.** A second of compositing in every eight. Last, because it is the
 *    cheapest and because a cut is the most noticeable of the three losses.
 *
 * ## What is *not* on the ladder, and will not be
 *
 * The guest's critical path. Join, pick, send. Roadmap 11.3's third non-goal is explicit
 * that nothing there may get slower or longer, and the converse holds too: there is nothing
 * in it to switch off. A guest whose phone is struggling loses a blur and keeps every
 * control, every label and every affordance they had.
 *
 * ## Every rung is a rendering this product already ships
 *
 * That is the argument for doing this automatically at all. Shedding `glass` lands on the
 * tier `@supports not (backdrop-filter)` and `prefers-reduced-transparency` already land
 * on; shedding `ken-burns` and `crossfade` lands on exactly what `prefers-reduced-motion`
 * renders, which has committed visual baselines of its own. So a degraded wall is not an
 * unreviewed look — it is a reviewed one, arrived at for a second reason.
 */

/** The order, and the whole of the rule. Everything below is derived from it. */
export const SHED_ORDER = ['glass', 'ken-burns', 'crossfade'] as const

export type Cost = (typeof SHED_ORDER)[number]

/**
 * How many of `SHED_ORDER` have been given up.
 *
 * A count rather than a name, because the thing that matters about a rung is which side of
 * it a cost falls on, and a count is the only spelling of that which cannot disagree with
 * the order above.
 */
export type BudgetLevel = 0 | 1 | 2 | 3

/** Whether a surface at this level still pays for a given cost. */
export const affords = (level: BudgetLevel, cost: Cost): boolean =>
  SHED_ORDER.indexOf(cost) >= level

/** One more rung down, and never past the last one: what is left is the photograph. */
export const shedOne = (level: BudgetLevel): BudgetLevel =>
  level >= SHED_ORDER.length ? level : ((level + 1) as BudgetLevel)

/**
 * Where a surface starts, before any machine has been measured.
 *
 * The room starts one rung down and that is the whole of §13's "the room takes the fallback
 * and the guest keeps the blur": the wall's backdrop is never still — a crossfade, Ken
 * Burns, and since roadmap 1.4 a video clip decoding under both — so a filter there is
 * recomputed every frame at full screen, on a venue mini-PC, unattended, for eight hours.
 * That is a property of the surface rather than of the device, which is why it is a floor
 * and not something a measurement could ever undo.
 */
export const budgetFloorFor = (surface: GlassSurface): BudgetLevel => (surface === 'wall' ? 1 : 0)

/** What the wall has given up, for the stylesheets that have to know. */
export type WallBudget = 'still' | 'cut'

export interface WallBudgetProps {
  readonly 'data-wall-budget'?: WallBudget
}

/**
 * The marker the wall spreads on its own root.
 *
 * Absent while the wall still has its motion, for the reason `glassSurfaceProps` spreads
 * nothing on the strict tier: a wall that is coping renders the DOM it rendered before any
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
 * off, so restoring it invites a wall that oscillates — blur on, blur off, blur on — in
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

/** How many frames a second this stretch of intervals actually put on the glass. */
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

/**
 * The guest's budget, which is an interaction and not a frame.
 *
 * A frame rate is the wrong measurement for the upload screen: it is still between taps, so
 * its frames are perfect right up to the moment somebody touches it. What a guest on a
 * saturated venue Wi-Fi mid-encode actually meets is the tap that takes a second to do
 * anything — and unlike a frame rate, that has a published number rather than one this
 * repository would have had to invent. 200 ms is the threshold at which an interaction stops
 * counting as "good" in Interaction to Next Paint, which is the metric browsers expose.
 */
export const INTERACTION_BUDGET_MS = 200

/** The worst of a batch, because a guest remembers the slow tap and not the mean. */
export const interactionsHold = (durationsMs: readonly number[]): boolean =>
  durationsMs.every((ms) => ms <= INTERACTION_BUDGET_MS)
