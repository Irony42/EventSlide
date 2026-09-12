import type { Clock } from '../../application/ports/clock'

/** The real clock. The only place in the server that calls `new Date()` with no argument. */
export const systemClock: Clock = {
  now: () => new Date(),
}
