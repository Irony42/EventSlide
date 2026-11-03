/**
 * Counting down against the server's clock rather than the machine's.
 *
 * A projector, a phone and a laptop each have their own idea of "now", and a mini PC that was never
 * set right can be minutes off. A countdown that subtracts its own `Date.now()` from an instant the
 * server chose would show a different time on every screen. So a response that needs one carries
 * `serverNowMs` (the server's clock when it answered), and the client keeps the **offset** between
 * the two clocks and applies it every second: `ends - (localNow + offset)`.
 *
 * The offset is re-measured at every read, so it follows the machine's clock if it is corrected
 * mid-evening. It is corrected by half the round trip, because the server's instant was taken
 * somewhere in the middle of it.
 *
 * Shared by every surface that counts down (spec 10 here, spec 09 for the wall's phases).
 */

/**
 * `serverNowMs - localNowMs`, as it was when the answer came back.
 *
 * @param serverNowMs the server's clock, from the response
 * @param sentAtMs the local clock when the request left
 * @param receivedAtMs the local clock when the response arrived
 */
export const serverOffsetMs = (
  serverNowMs: number,
  sentAtMs: number,
  receivedAtMs: number,
): number => serverNowMs - (sentAtMs + (receivedAtMs - sentAtMs) / 2)

/** The server's clock now, from this machine's clock and the offset measured at the last read. */
export const serverNowFrom = (localNowMs: number, offsetMs: number): number => localNowMs + offsetMs

/** Milliseconds left until `endsAtMs`, never negative. */
export const remainingMs = (endsAtMs: number, localNowMs: number, offsetMs: number): number =>
  Math.max(0, endsAtMs - serverNowFrom(localNowMs, offsetMs))

/**
 * `m:ss`, rounding **up** to the whole second: "0:00" appears only when the time is truly out, so
 * a countdown never says zero while there is still a second on it.
 */
export const formatCountdown = (ms: number): string => {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}
