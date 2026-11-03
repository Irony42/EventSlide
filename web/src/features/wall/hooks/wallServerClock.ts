import { serverNowFrom, serverOffsetMs } from '../../../lib/serverClock'

/**
 * The server's clock for the wall's phase (spec 09), on the shared helpers of
 * `lib/serverClock.ts`.
 *
 * Unlike a countdown redrawn every second, a projector runs for eight hours, so the local clock
 * the offset is measured against is `performance.now()`, which is monotonic: a machine whose
 * date is set back at 22:00 does not move the phase. Until the first reading it answers the
 * machine's own date (a wall always holds one reading before it needs a phase, because the
 * schedule and the stamp arrive in the same response).
 */
export interface WallServerClock {
  /** Server time in milliseconds, as of this instant. */
  now(): number
  /** Records a reading: the response's `serverNowMs` and the monotonic times around its request. */
  sync(serverNowMs: number, sentAt: number, receivedAt: number): void
}

export interface WallClockSources {
  readonly monotonic: () => number
  readonly local: () => number
}

export const createWallServerClock = (
  sources: WallClockSources = { monotonic: () => performance.now(), local: () => Date.now() },
): WallServerClock => {
  let offset: number | null = null
  return {
    now: () => (offset === null ? sources.local() : serverNowFrom(sources.monotonic(), offset)),
    sync: (serverNowMs, sentAt, receivedAt) => {
      offset = serverOffsetMs(serverNowMs, sentAt, receivedAt)
    },
  }
}
