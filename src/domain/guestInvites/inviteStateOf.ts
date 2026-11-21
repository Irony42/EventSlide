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

/** The moment an invitation announces, in the zone it is read in. */
export interface InviteSchedule {
  readonly startsAt: Date
  readonly endsAt: Date | null
  readonly timeZone: string
}

/** Present only when the invitation has a start and the zone to read it in. */
export const scheduleOf = (invite: GuestInvite): InviteSchedule | null => {
  const { startsAt, endsAt, timeZone } = invite.content
  return startsAt === null || timeZone === null ? null : { startsAt, endsAt, timeZone }
}

export interface ServedInvite {
  readonly state: Exclude<InviteState, 'unavailable'>
  readonly schedule: InviteSchedule
}

/**
 * The state **and** the schedule of a page that exists, or `null` for one that does not: a caller
 * that serves a page gets both from one decision and never re-derives either.
 */
export const servedInviteOf = (event: Event, invite: GuestInvite): ServedInvite | null => {
  const schedule = scheduleOf(invite)
  if (!invite.enabled || schedule === null) return null
  if (event.status === 'archived' || event.isTakenDown() || event.isClientSuspended()) return null
  if (event.acceptsGuests()) return { state: 'joinable', schedule }
  return { state: event.status === 'closed' ? 'over' : 'upcoming', schedule }
}

export const inviteStateOf = (event: Event, invite: GuestInvite): InviteState =>
  servedInviteOf(event, invite)?.state ?? 'unavailable'
