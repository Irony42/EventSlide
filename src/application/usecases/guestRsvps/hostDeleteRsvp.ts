import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestRsvpId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import { announceRsvpsChanged, openRsvps, recordRsvpAct, type RsvpAccessDeps } from './rsvpAccess'

/**
 * The host deletes a reply (spec 30). `404 rsvp.notFound` for a reply that is not this event's or
 * that is already gone. Needs no invitation: replies outlive an invitation that was switched off,
 * and the host must be able to remove one (it holds names and diets).
 */

export interface HostDeleteRsvpInput {
  readonly eventId: EventId
  readonly actorId: UserId
  readonly rsvpId: GuestRsvpId
}

export interface HostDeleteRsvpDeps extends RsvpAccessDeps {
  readonly rsvps: Pick<GuestRsvpRepository, 'findById' | 'delete'>
  readonly audit: AuditRecorder
  readonly bus: EventBus
  readonly clock: Clock
}

export type HostDeleteRsvp = (input: HostDeleteRsvpInput) => Promise<Result<void, DomainError>>

export const makeHostDeleteRsvp =
  (deps: HostDeleteRsvpDeps): HostDeleteRsvp =>
  async ({ eventId, actorId, rsvpId }) => {
    const opened = await openRsvps(deps, eventId, actorId, 'write')
    if (!opened.ok) return opened
    if ((await deps.rsvps.findById(eventId, rsvpId)) === null) {
      return err(DomainError.notFound('rsvp.notFound'))
    }

    const recorded = await recordRsvpAct(
      deps.audit,
      opened.value.event,
      actorId,
      'event.rsvpHostDeleted',
      deps.clock.now(),
    )
    if (!recorded.ok) return recorded
    await deps.rsvps.delete(eventId, rsvpId)
    announceRsvpsChanged(deps.bus, eventId)
    return ok(undefined)
  }
