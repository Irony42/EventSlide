import type { Clock } from '../../application/ports/clock'

/**
 * The real clock: what every adapter that decides by time (a session's expiry, a migration's
 * stamp) is handed. The only place in `src` that calls `new Date()` with no argument; the one
 * `Date.now()` left is `fsMediaStore`'s comparison of a file's age, which says why where it is.
 */
export const systemClock: Clock = {
  now: () => new Date(),
}
