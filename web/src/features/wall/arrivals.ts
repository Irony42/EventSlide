/**
 * What just became visible on the wall, and when to say so (spec 11, rules 3 to 6).
 *
 * Pure: no React, the clock is an argument. Spec 12 (the arrival sound) reuses
 * {@link detectArrivals} and the server's `souvenirCount`, so what both announce is one fact.
 * The component only renders (CLAUDE.md 3.1).
 */

/** A read older than this makes the next one a resumption: sleep, outage, a reopened laptop. */
export const RESUME_GAP_MS = 2 * 60_000
/** How long the signal stays on screen. */
export const TOAST_VISIBLE_MS = 4_000
/** At most one signal starts per interval: a burst of uploads is announced together. */
export const TOAST_MIN_GAP_MS = 10_000

export interface SnapshotItem {
  readonly id: string
  readonly kind: 'photo' | 'clip'
}

/** What the wall answered at one successful read. `total` is the server's `souvenirCount`. */
export interface WallSnapshot {
  readonly items: readonly SnapshotItem[]
  readonly total: number | null
  readonly at: number
}

export interface Arrivals {
  readonly photos: number
  readonly clips: number
}

export const NO_ARRIVALS: Arrivals = { photos: 0, clips: 0 }

const sizeOf = (arrivals: Arrivals): number => arrivals.photos + arrivals.clips

/**
 * Which items became visible between two reads.
 *
 * - No earlier read, or one more than {@link RESUME_GAP_MS} ago: silence (rule 4).
 * - "New" means present now and absent before, whenever it was sent (rule 3).
 * - The count is capped by how much the server's total grew (rule 5): a deletion that lets the
 *   201st photo into the 200-photo window grows `items` but lowers the total, and announces
 *   nothing. Better a missed signal than a false one. Without a total on both sides there is
 *   nothing to check against, so nothing is announced.
 */
export const detectArrivals = (before: WallSnapshot | null, after: WallSnapshot): Arrivals => {
  if (before === null || before.total === null || after.total === null) return NO_ARRIVALS
  if (after.at - before.at > RESUME_GAP_MS) return NO_ARRIVALS

  const known = new Set(before.items.map((item) => item.id))
  const fresh = after.items.filter((item) => !known.has(item.id))
  const counted = fresh.slice(0, Math.min(fresh.length, Math.max(0, after.total - before.total)))

  return {
    photos: counted.filter((item) => item.kind === 'photo').length,
    clips: counted.filter((item) => item.kind === 'clip').length,
  }
}

/** What the bubble says: a count of photos, of clips, or of both. */
export interface Bubble {
  readonly photos: number
  readonly clips: number
  /** Until when it stays up. */
  readonly until: number
}

export interface SignalState {
  /** Arrivals set aside, announced together at the next start. */
  readonly reserve: Arrivals
  readonly lastStartAt: number | null
  /**
   * Set while the timed challenge's banner owns the top centre (spec 10, decision 11-4): nothing
   * starts, the arrivals wait in `reserve` (held, not dropped) and are announced together once it
   * is released. One input to this reducer, not a second mechanism beside it.
   */
  readonly held: boolean
  /** The one bubble on screen, if any. Never a queue. */
  readonly visible: Bubble | null
}

export const INITIAL_SIGNAL: SignalState = {
  reserve: NO_ARRIVALS,
  lastStartAt: null,
  held: false,
  visible: null,
}

export type SignalEvent =
  | { readonly type: 'arrive'; readonly arrivals: Arrivals }
  | { readonly type: 'tick' }
  /** The challenge banner went up (`true`) or away (`false`). */
  | { readonly type: 'hold'; readonly held: boolean }
  /** The switch was turned off: forget what was set aside. */
  | { readonly type: 'reset' }

/**
 * The reserve reducer (rule 6): `(state, event, now) -> state`; the bubble to draw is
 * `state.visible`. The first signal starts at once; the next ones wait for the interval and
 * leave together; an empty reserve starts nothing; only one bubble exists at a time.
 */
export const reduceSignal = (state: SignalState, event: SignalEvent, now: number): SignalState => {
  if (event.type === 'reset') return INITIAL_SIGNAL

  const held = event.type === 'hold' ? event.held : state.held
  const visible = state.visible !== null && now < state.visible.until ? state.visible : null
  const arrived =
    event.type === 'arrive'
      ? {
          photos: state.reserve.photos + event.arrivals.photos,
          clips: state.reserve.clips + event.arrivals.clips,
        }
      : state.reserve
  // A bubble on screen when the banner goes up goes back to the reserve: held, not dropped.
  const sweeping = held && visible !== null
  const reserve = sweeping
    ? { photos: arrived.photos + visible.photos, clips: arrived.clips + visible.clips }
    : arrived

  const mayStart =
    !held &&
    sizeOf(reserve) > 0 &&
    visible === null &&
    (state.lastStartAt === null || now - state.lastStartAt >= TOAST_MIN_GAP_MS)

  return mayStart
    ? {
        reserve: NO_ARRIVALS,
        lastStartAt: now,
        held,
        visible: { ...reserve, until: now + TOAST_VISIBLE_MS },
      }
    : { reserve, lastStartAt: state.lastStartAt, held, visible: sweeping ? null : visible }
}

/** When the reducer next has something to do on its own, in ms from `now`; `null` for never. */
export const nextWakeMs = (state: SignalState, now: number): number | null => {
  // Held: nothing starts on its own, and nothing is on screen to hide.
  if (state.held) return null
  const hideIn = state.visible === null ? null : Math.max(0, state.visible.until - now)
  const startIn =
    sizeOf(state.reserve) === 0
      ? null
      : Math.max(
          hideIn ?? 0,
          state.lastStartAt === null ? 0 : state.lastStartAt + TOAST_MIN_GAP_MS - now,
        )
  if (hideIn === null) return startIn
  return startIn === null ? hideIn : Math.min(hideIn, startIn)
}
