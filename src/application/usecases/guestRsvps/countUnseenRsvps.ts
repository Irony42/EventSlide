import type { EventId, UserId } from '../../../domain/shared/ids'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'

/**
 * The badge on the replies entry of the host's event menu (spec 30, section 8): how many replies
 * were written or changed since this member last looked. For the event answer of an **owner**
 * only, whose role the route has already checked; no other state is read.
 */

export interface CountUnseenRsvpsInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface CountUnseenRsvpsDeps {
  readonly rsvps: Pick<GuestRsvpRepository, 'unseenCount'>
}

export type CountUnseenRsvps = (input: CountUnseenRsvpsInput) => Promise<number>

export const makeCountUnseenRsvps =
  ({ rsvps }: CountUnseenRsvpsDeps): CountUnseenRsvps =>
  ({ eventId, actorId }) =>
    rsvps.unseenCount(eventId, actorId)
