import type { GuestRsvp } from '../../../domain/guestRsvps/rsvp'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestHouseholdId, GuestRsvpId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventBus } from '../../ports/eventBus'
import type { GuestHouseholdRepository } from '../../ports/guestHouseholdRepository'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import { householdNotFound } from './householdAccess'
import { announceRsvpsChanged, openRsvps, type RsvpAccessDeps } from './rsvpAccess'

/**
 * "Associer à un foyer" (spec 30, lot 3): the host files a reply under a household of the list
 * (a guest who answered on the common link, or whom the host typed in), or detaches it with
 * `null`. Then the household's count is no longer "sans réponse", and the household's link opens
 * that reply.
 *
 * - the household must be **this event's** (`404 household.notFound`), the reply too
 *   (`404 rsvp.notFound`, also for one that vanished meanwhile);
 * - **one reply per household**: `409 household.alreadyAnswered` when another already answers for
 *   it (decided inside the write: two hosts' tabs cannot both win);
 * - changes nothing else, **not even the reply's `updatedAt`** (the badge counts what guests wrote,
 *   not the host's filing); refused on an archived event; announced.
 */

export interface AttachRsvpInput {
  readonly eventId: EventId
  readonly actorId: UserId
  readonly rsvpId: GuestRsvpId
  /** `null` detaches the reply. */
  readonly householdId: GuestHouseholdId | null
}

export interface AttachRsvpDeps extends RsvpAccessDeps {
  readonly households: Pick<GuestHouseholdRepository, 'findById'>
  readonly rsvps: Pick<GuestRsvpRepository, 'setHousehold' | 'findById'>
  readonly bus: EventBus
}

export type AttachRsvpToHousehold = (
  input: AttachRsvpInput,
) => Promise<Result<GuestRsvp, DomainError>>

export const makeAttachRsvpToHousehold =
  (deps: AttachRsvpDeps): AttachRsvpToHousehold =>
  async ({ eventId, actorId, rsvpId, householdId }) => {
    const opened = await openRsvps(deps, eventId, actorId, 'write')
    if (!opened.ok) return opened
    if (householdId !== null && (await deps.households.findById(eventId, householdId)) === null) {
      return err(householdNotFound())
    }
    const outcome = await deps.rsvps.setHousehold(eventId, rsvpId, householdId)
    if (outcome === 'gone') return err(DomainError.notFound('rsvp.notFound'))
    if (outcome === 'taken') return err(DomainError.conflict('household.alreadyAnswered'))
    const rsvp = await deps.rsvps.findById(eventId, rsvpId)
    // Deleted between the write and the read: the filing is moot, the reply is gone.
    if (rsvp === null) return err(DomainError.notFound('rsvp.notFound'))
    announceRsvpsChanged(deps.bus, eventId)
    return ok(rsvp)
  }
