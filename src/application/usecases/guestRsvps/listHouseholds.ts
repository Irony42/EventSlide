import type { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { GuestHouseholdRepository } from '../../ports/guestHouseholdRepository'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import { householdReplyOf, type HostHousehold } from './householdAccess'
import { openRsvps, type RsvpAccessDeps } from './rsvpAccess'

/**
 * The host's guest list (spec 30, lot 3): every household in the order it was listed, with the
 * reply that answers for it, if any, so that "sans réponse" is the households with none.
 * The owner's door, as for the replies; a read, so it works on a closed or archived event.
 */

export interface ListHouseholdsInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface ListHouseholdsDeps extends RsvpAccessDeps {
  readonly households: Pick<GuestHouseholdRepository, 'listByEvent'>
  readonly rsvps: Pick<GuestRsvpRepository, 'listByEvent'>
}

export type ListHouseholds = (
  input: ListHouseholdsInput,
) => Promise<Result<readonly HostHousehold[], DomainError>>

export const makeListHouseholds =
  (deps: ListHouseholdsDeps): ListHouseholds =>
  async ({ eventId, actorId }) => {
    const opened = await openRsvps(deps, eventId, actorId, 'read')
    if (!opened.ok) return opened
    const households = await deps.households.listByEvent(eventId)
    const byHousehold = new Map(
      (await deps.rsvps.listByEvent(eventId)).flatMap((rsvp) =>
        rsvp.householdId === null ? [] : [[rsvp.householdId, rsvp] as const],
      ),
    )
    return ok(
      households.map((household) => ({
        household,
        reply: householdReplyOf(byHousehold.get(household.id) ?? null),
      })),
    )
  }
