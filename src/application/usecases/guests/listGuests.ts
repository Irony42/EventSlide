import { canModerate } from '../../../domain/events/eventRole'
import type { Guest } from '../../../domain/guests/guest'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { GuestRepository } from '../../ports/guestRepository'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * The host's guest list, plus how many of those guests are in the room right now.
 *
 * Two different questions, deliberately answered together. The list is everyone who
 * ever scanned the code — including the guests the host revoked, because a removal the
 * host cannot see afterwards looks like a button that did nothing. The count is
 * presence, and it excludes revoked guests for the same reason.
 */

/**
 * How recently a guest must have been seen to count as being at the party.
 *
 * Five minutes: long enough to cover a guest who is watching the wall between uploads,
 * short enough that the number means "here now" rather than "was here this evening" —
 * which is the number a host actually uses when deciding whether to keep the slideshow
 * running.
 *
 * **Not the caller's choice, on purpose.** `GET /events/:slug/guests` once accepted an
 * `activeWithinMinutes` between 1 and 1 440 and the route dropped it, so the parameter
 * read as an oversight; it is gone from `guestListQuery` and sending one is now a 400.
 * Threading it through would have been the other legitimate branch, and it was refused
 * for the reason the window exists: `activeCount` is one number on a console read across
 * a room, so a window the caller picks makes the same field mean "here now" to one
 * screen and "was here this evening" to the next, with nothing on the wire saying which.
 * At the top of the old range it would have converged on `guests.length`, which the same
 * response already carries. If a host ever genuinely needs a second horizon, it is a
 * second named field — `seenThisHourCount` — and not a knob that redefines this one.
 */
export const PRESENCE_WINDOW_MS = 5 * 60 * 1_000

export interface ListGuestsInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface ListGuestsOutput {
  /** Most recently seen first — the order the repository guarantees. */
  readonly guests: readonly Guest[]
  readonly activeCount: number
}

export interface ListGuestsDeps {
  readonly guests: GuestRepository
  readonly memberships: MembershipRepository
  readonly clock: Clock
}

export type ListGuests = (input: ListGuestsInput) => Promise<Result<ListGuestsOutput, DomainError>>

export const makeListGuests =
  ({ guests, memberships, clock }: ListGuestsDeps): ListGuests =>
  async ({ eventId, actorId }) => {
    const role = await memberships.roleFor(eventId, actorId)
    // Same answer as an event that does not exist: a moderator of one wedding must not
    // be able to tell, from this endpoint, that another event exists at all.
    if (role === null || !canModerate(role)) return err(DomainError.notFound('event.notFound'))

    const since = new Date(clock.now().getTime() - PRESENCE_WINDOW_MS)

    return ok({
      guests: await guests.list(eventId),
      activeCount: await guests.countActive(eventId, since),
    })
  }
