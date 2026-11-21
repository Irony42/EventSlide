import type { Event } from '../events/event'
import type { GuestInvite } from './guestInvite'

/**
 * What an invitation's public page shows right now (spec 29):
 *
 * - `upcoming`: the details, before the evening (or while the wall is not open yet);
 * - `joinable`: the evening is on, the page also offers the way into the wall;
 * - `over`: the event is closed, the page says so and serves neither address nor word;
 * - `unavailable`: the page does not exist for the public (one neutral answer).
 *
 * **The hour of the party is not an input.** The event's status decides, so a host who opens the
 * wall late (or early, for a test) is followed by the page, and a party whose hour has passed
 * but was never opened stays `upcoming`. The page shows this state; it never recomputes it.
 *
 * The event must have been read by id: that is the only read that fills `clientSuspendedAt` and
 * `takenDownAt`, which make a page unavailable.
 */
export type InviteState = 'upcoming' | 'joinable' | 'over' | 'unavailable'

export const inviteStateOf = (event: Event, invite: GuestInvite): InviteState => {
  if (!invite.enabled || invite.content.startsAt === null) return 'unavailable'
  if (event.status === 'archived' || event.isTakenDown() || event.isClientSuspended()) {
    return 'unavailable'
  }
  if (event.acceptsGuests()) return 'joinable'
  if (event.status === 'closed') return 'over'
  return 'upcoming'
}
