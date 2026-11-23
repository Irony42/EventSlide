import type { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import { openRsvps, type RsvpAccessDeps } from './rsvpAccess'

/**
 * The host has looked at the replies (spec 30, section 8): the badge counts from now on. Kept per
 * member, on the server, so it follows them from one device to another. Asked like any read (a suspended
 * client's host reads nothing, `403 client.suspended`); nothing is audited or announced.
 */

export interface MarkRsvpsSeenInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface MarkRsvpsSeenDeps extends RsvpAccessDeps {
  readonly rsvps: Pick<GuestRsvpRepository, 'markSeen'>
  readonly clock: Clock
}

export type MarkRsvpsSeen = (input: MarkRsvpsSeenInput) => Promise<Result<void, DomainError>>

export const makeMarkRsvpsSeen =
  (deps: MarkRsvpsSeenDeps): MarkRsvpsSeen =>
  async ({ eventId, actorId }) => {
    const opened = await openRsvps(deps, eventId, actorId, 'read')
    if (!opened.ok) return opened
    await deps.rsvps.markSeen(eventId, actorId, deps.clock.now())
    return ok(undefined)
  }
