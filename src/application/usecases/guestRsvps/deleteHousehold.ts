import type { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestHouseholdId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { GuestHouseholdRepository } from '../../ports/guestHouseholdRepository'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import { householdNotFound } from './householdAccess'
import { announceRsvpsChanged, openRsvps, recordRsvpAct, type RsvpAccessDeps } from './rsvpAccess'

/**
 * The host deletes a household (spec 30, lot 3). **Its reply is kept**, detached (`household_id`
 * back to `NULL`, no foreign key to do it for us): a guest's word is not the host's to lose by
 * tidying the list, and the host deletes a reply on its own account.
 *
 * `404 household.notFound` for one that is not this event's or is already gone. **Allowed on an
 * archived event** (the list holds names, so it must stay removable: the door is asked as a
 * read, as the deletion of a reply does). Audited without a name, before the change.
 */

export interface DeleteHouseholdInput {
  readonly eventId: EventId
  readonly actorId: UserId
  readonly householdId: GuestHouseholdId
}

export interface DeleteHouseholdDeps extends RsvpAccessDeps {
  readonly households: Pick<GuestHouseholdRepository, 'findById' | 'delete'>
  readonly rsvps: Pick<GuestRsvpRepository, 'detachHousehold'>
  readonly audit: AuditRecorder
  readonly bus: EventBus
  readonly clock: Clock
}

export type DeleteHousehold = (input: DeleteHouseholdInput) => Promise<Result<void, DomainError>>

export const makeDeleteHousehold =
  (deps: DeleteHouseholdDeps): DeleteHousehold =>
  async ({ eventId, actorId, householdId }) => {
    const opened = await openRsvps(deps, eventId, actorId, 'read')
    if (!opened.ok) return opened
    if ((await deps.households.findById(eventId, householdId)) === null) {
      return err(householdNotFound())
    }
    const recorded = await recordRsvpAct(
      deps.audit,
      opened.value.event,
      actorId,
      'event.householdDeleted',
      deps.clock.now(),
    )
    if (!recorded.ok) return recorded
    // The reply first: a household gone with a reply still pointing at it would be a dangling id.
    await deps.rsvps.detachHousehold(eventId, householdId)
    // A household deleted between the read and here: nothing was done, nothing is said.
    if (!(await deps.households.delete(eventId, householdId))) return err(householdNotFound())
    announceRsvpsChanged(deps.bus, eventId)
    return ok(undefined)
  }
