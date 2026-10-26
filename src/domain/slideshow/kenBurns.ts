import type { SlideInterval } from './slideInterval'

/**
 * The slow zoom on the projected photo — and the one piece of arithmetic that keeps it
 * from snapping.
 *
 * 1.0 hardcoded a 20s zoom next to a 10s default slide interval, so the animation was
 * still halfway through when the next photo arrived and every image visibly jumped
 * back to its start scale. The fix is not a longer animation: it is that the duration
 * exists only as a function of the interval, so there is no second setting left to
 * fall out of sync with the first.
 */

/**
 * The dissolve between two slides. Both photos are on screen for this long, so the
 * outgoing one has to still be moving while it fades out. 800ms reads as a dissolve at
 * projector distance — much shorter looks like a cut — and it stays a minority of even
 * the shortest slide the host can choose.
 */
export const CROSSFADE_MS = 800

/**
 * Slide duration plus the crossfade.
 *
 * The zoom has to outlast the slide by exactly the time the two photos overlap,
 * otherwise the last 800ms of every photo is frozen while the next one fades in — the
 * stutter that reads as a bug from the back of the room. Because `CROSSFADE_MS` is a
 * positive constant, the result is always longer than the interval: the 1.0 snap is
 * unrepresentable here rather than clamped away, which is why there is no guard to
 * test.
 */
export const kenBurnsDurationMs = (interval: SlideInterval): number => interval.ms + CROSSFADE_MS
