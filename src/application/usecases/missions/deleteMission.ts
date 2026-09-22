import { canManageEvent } from '../../../domain/events/eventRole'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, MissionId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { MissionRepository } from '../../ports/missionRepository'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * The host removes a prompt from the list.
 *
 * **It removes a prompt and never a photograph.** The photographs filed under it are
 * unfiled — `ON DELETE SET NULL` in the schema, asserted on both implementations by the
 * port's contract suite — and stay in the album, in the queue, in the export and on the
 * wall exactly as they were. They are ordinary photographs, which is §2.1's own rule
 * about what happens to a mission's photographs afterwards.
 *
 * The lookup before the delete is not ceremony: `delete` is idempotent by contract, so
 * without it a host deleting somebody else's mission id would be answered `204` and
 * learn that ids from another event are silently accepted here.
 */

export interface DeleteMissionInput {
  readonly eventId: EventId
  readonly missionId: MissionId
  readonly actorId: UserId
}

export interface DeleteMissionDeps {
  readonly events: EventRepository
  readonly missions: MissionRepository
  readonly memberships: MembershipRepository
  readonly bus: EventBus
}

export type DeleteMission = (input: DeleteMissionInput) => Promise<Result<void, DomainError>>

export const makeDeleteMission =
  ({ events, missions, memberships, bus }: DeleteMissionDeps): DeleteMission =>
  async ({ eventId, missionId, actorId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const role = await memberships.roleFor(eventId, actorId)
    if (role === null) return err(DomainError.notFound('event.notFound'))
    if (!canManageEvent(role)) {
      return err(DomainError.forbidden('auth.forbidden', { required: 'owner' }))
    }

    if (!event.allowsEditing()) {
      return err(DomainError.conflict('event.immutable', { status: event.status }))
    }

    const mission = await missions.findById(eventId, missionId)
    if (mission === null) return err(DomainError.notFound('mission.notFound'))

    await missions.delete(eventId, missionId)
    bus.publish({ type: 'mission.changed', eventId })

    return ok(undefined)
  }
