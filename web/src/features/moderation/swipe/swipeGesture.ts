import type { ModerationDecision } from '../../../lib/api/dto'

/**
 * The arithmetic behind "swipe right to publish, left to refuse".
 *
 * Pure, and deliberately separate from the hook that feeds it pointer events. What
 * makes a swipe usable is a handful of numbers — how far is far enough, when the host
 * is told which way it is going, what taking it back means — and each of them is a rule
 * that can be stated and checked without a DOM, a pointer, or a `transform` to assert
 * on. A test that reads a `translateX` out of a style attribute proves the component
 * multiplied two numbers; it does not protect the rule that a gesture dragged back is
 * a gesture cancelled.
 */

/**
 * The two decisions a direction can carry.
 *
 * `hide` is not one of them. It only applies to a photo already on the wall, and this
 * surface judges photos that are still waiting — a third direction would also mean a
 * gesture nobody can guess.
 */
export type SwipeIntent = Extract<ModerationDecision, 'publish' | 'reject'>

/**
 * How far the card must travel, as a share of its own width.
 *
 * A share rather than a fixed distance: the same gesture has to feel the same on a
 * 360 px phone and on a 430 px one. A quarter of the card is far enough to be
 * deliberate and short enough for one thumb travelling across a screen held in one
 * hand.
 */
const COMMIT_RATIO = 0.25

/** A floor, so a card measured at nothing — a fresh layout — cannot commit instantly. */
const MIN_COMMIT_PX = 56

/** A ceiling, so a tablet in landscape does not ask for a forearm-length drag. */
const MAX_COMMIT_PX = 144

/**
 * Where the intent appears.
 *
 * Small on purpose: the host has to be told which way the card is going long before it
 * is decided, because the whole safety of a swipe is the chance to change your mind.
 * Large enough that a tap with a shaky thumb does not flash "Publier" at them.
 */
const INTENT_PX = 12

export interface SwipeInput {
  /** Distance travelled since the finger went down, in CSS pixels. Right is positive. */
  readonly dx: number
  /** The vertical companion. Only used to tell a decision from a scroll. */
  readonly dy: number
  /** The card's own width, so the commit distance scales with the screen. */
  readonly width: number
  /**
   * Whether this gesture has already been read as horizontal once.
   *
   * The axis is decided at the start and then kept, which is what a touch screen does
   * on its own: `touch-action: pan-y` hands the gesture to the card the moment it goes
   * sideways, and the browser does not take it back when the thumb drifts down. Without
   * the same latch here, a hand pivoting from the wrist — an arc, not a line, and the
   * only kind a mouse on the laptop preview can draw — turns a deliberate swipe into a
   * card that snaps back to centre under a thumb that never lifted.
   *
   * Absent means not yet: the first reading of a gesture is always unlatched, so a
   * genuine vertical scroll can never claim the card.
   */
  readonly locked?: boolean
}

export interface SwipeReading {
  /** How far to move the card. Zero while the gesture is still a vertical scroll. */
  readonly offset: number
  /** Which way it is going, or `null` while it is going nowhere in particular. */
  readonly intent: SwipeIntent | null
  /** 0 to 1, how close the gesture is to deciding. Drives the strength of the hint. */
  readonly progress: number
  /** Far enough that letting go now decides. */
  readonly committed: boolean
}

const NEUTRAL: SwipeReading = { offset: 0, intent: null, progress: 0, committed: false }

/**
 * How far this card has to travel before a release decides anything.
 *
 * Exported because it is the number a host feels and a test has to agree with, and
 * because a component that re-derived it would be free to disagree.
 */
export const commitDistance = (width: number): number =>
  Math.min(Math.max(width * COMMIT_RATIO, MIN_COMMIT_PX), MAX_COMMIT_PX)

/**
 * What the gesture currently means.
 *
 * Derived from where the finger is *now*, never accumulated. That is the whole reason
 * a swipe is cancellable: dragging back under the commit distance is not a special
 * case handled somewhere, it is simply a smaller number producing an uncommitted
 * reading.
 */
export const readSwipe = ({ dx, dy, width, locked = false }: SwipeInput): SwipeReading => {
  const distance = Math.abs(dx)

  // A gesture that is mostly vertical is the host scrolling, not deciding. The card
  // stays put so the page can move under it, and nothing is announced — unless the
  // card already owns this gesture, in which case it keeps it to the end.
  if (!locked && distance <= Math.abs(dy)) return NEUTRAL

  const progress = Math.min(distance / commitDistance(width), 1)

  return {
    offset: dx,
    intent: distance < INTENT_PX ? null : dx > 0 ? 'publish' : 'reject',
    progress,
    committed: progress >= 1,
  }
}

/**
 * What letting go here decides. `null` when the host took the swipe back.
 *
 * `committed` cannot be true below the commit distance, and the commit distance is
 * never smaller than the distance at which an intent appears — so a committed reading
 * always carries one.
 */
export const decisionOnRelease = (reading: SwipeReading): SwipeIntent | null =>
  reading.committed ? reading.intent : null
