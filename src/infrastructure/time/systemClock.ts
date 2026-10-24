import type { Clock } from '../../application/ports/clock'

/**
 * The real clock: what the composition root hands to every use case and adapter that decides by
 * time (a session's expiry, a migration's stamp, a sweep's deadline), so a test can hand them
 * a `FakeClock` instead. `fsMediaStore` compares a file's age with `Date.now()` and says why
 * where it does.
 */
export const systemClock: Clock = {
  now: () => new Date(),
}
