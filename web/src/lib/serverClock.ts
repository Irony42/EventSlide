/**
 * The server's clock as this browser can read it (specs 09 and 10).
 *
 * A projector's own clock may be minutes off, and two projectors in one room must still agree on
 * a phase or a countdown. The server stamps `serverNowMs` on what it sends; this keeps the
 * offset between that stamp and the machine and answers "what time is it on the server" from it.
 *
 * **The offset is read at the middle of the round trip** (the stamp was taken about halfway
 * between the request leaving and the answer arriving), and time then advances with
 * `performance.now()`, which is monotonic: a machine whose wall clock is set back at 22:00 does
 * not move the phase.
 */

export interface ServerClock {
  /** Server time, in milliseconds, as of this instant. `null` until a reading has been taken. */
  now(): number | null
  /** Records a reading: `serverNowMs` from a response, and the monotonic times around its request. */
  sync(serverNowMs: number, sentAt: number, receivedAt: number): void
}

export interface ServerClockSources {
  /** Monotonic milliseconds (`performance.now`). */
  readonly monotonic: () => number
}

/** The offset to add to a monotonic reading to get server time. */
export const serverOffsetMs = (serverNowMs: number, sentAt: number, receivedAt: number): number =>
  serverNowMs - (sentAt + receivedAt) / 2

export const createServerClock = (
  sources: ServerClockSources = { monotonic: () => performance.now() },
): ServerClock => {
  let offset: number | null = null
  return {
    now: () => (offset === null ? null : sources.monotonic() + offset),
    sync: (serverNowMs, sentAt, receivedAt) => {
      offset = serverOffsetMs(serverNowMs, sentAt, receivedAt)
    },
  }
}
