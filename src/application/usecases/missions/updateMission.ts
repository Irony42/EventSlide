import { canManageEvent } from '../../../domain/events/eventRole'
import type { Mission } from '../../../domain/missions/mission'
import { MissionPrompt } from '../../../domain/missions/missionPrompt'
import type { MissionScope } from '../../../domain/missions/missionScope'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, MissionId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { MissionRepository } from '../../ports/missionRepository'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * The host corrects a prompt, or changes who it is asked of.
 *
 * **This is the reason editing exists at all rather than delete-and-recreate.** Deleting
 * a mission unfiles every photograph that named it, so a host fixing "la première dance"
 * that way would silently take four photographs out of the count they were already in.
 * Editing keeps the id, so it keeps the photographs.
 *
 * Both fields at once, never one: the host edits one row on one form, and a partial
 * update would let a scope be persisted beside a prompt that was refused.
 */

export interface UpdateMissionInput {
  readonly eventId: EventId
  readonly missionId: MissionId
  readonly actorId: UserId
  readonly prompt: string
  readonly scope: MissionScope
}

export interface UpdateMissionDeps {
  readonly events: EventRepository
  readonly missions: MissionRepository
  readonly memberships: MembershipRepository
  readonly bus: EventBus
}

export type UpdateMission = (input: UpdateMissionInput) => Promise<Result<Mission, DomainError>>

export const makeUpdateMission =
  ({ events, missions, memberships, bus }: UpdateMissionDeps): UpdateMission =>
  async ({ eventId, missionId, actorId, prompt, scope }) => {
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

    // Scoped read: passing eventId is what makes another event's mission unreachable.
    const mission = await missions.findById(eventId, missionId)
    if (mission === null) return err(DomainError.notFound('mission.notFound'))

    const parsed = MissionPrompt.create(prompt)
    if (!parsed.ok) return parsed

    // A prompt that already exists is a conflict unless it is this row's own — a host
    // who changes only the scope sends the prompt back unchanged, and refusing that
    // would make the scope uneditable.
    const holder = await missions.findByPrompt(eventId, parsed.value)
    if (holder !== null && !holder.equals(mission)) {
      return err(DomainError.conflict('mission.duplicate'))
    }

    const edited = mission.edit(parsed.value, scope)
    await missions.save(edited)
    bus.publish({ type: 'mission.changed', eventId })

    return ok(edited)
  }
