import type { Clock } from '../../ports/clock'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'

/**
 * Erases the replies whose time has come (spec 30, section 7), from the retention sweeper: 30 days
 * after the event closed or 60 after the invitation's start, whichever is first (`rsvpExpiryOf`).
 * It reads no event and asks no hold: **the purge hold does not keep replies**, they are names and
 * diets, not an album. Run before the public form opens, because collecting without erasing is the
 * one order that is wrong.
 */

export interface PurgeExpiredRsvpsDeps {
  readonly rsvps: Pick<GuestRsvpRepository, 'deleteExpired'>
  readonly clock: Clock
}

export interface PurgeExpiredRsvpsReport {
  readonly deleted: number
}

export type PurgeExpiredRsvps = () => Promise<PurgeExpiredRsvpsReport>

export const makePurgeExpiredRsvps =
  ({ rsvps, clock }: PurgeExpiredRsvpsDeps): PurgeExpiredRsvps =>
  async () => ({ deleted: await rsvps.deleteExpired(clock.now()) })
