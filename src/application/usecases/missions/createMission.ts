import {
  hasRoomForMission,
  MAX_MISSIONS_PER_EVENT,
  Mission,
} from '../../../domain/missions/mission'
import { MissionPrompt } from '../../../domain/missions/missionPrompt'
import type { MissionScope } from '../../../domain/missions/missionScope'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { MissionRepository } from '../../ports/missionRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { requireEditable, requireEventRole, requireWritable } from '../shared/eventRole'

/**
 * The host adds a prompt to the list (roadmap §2.1).
 *
 * **Owner only, like every other decision about what the event *is*.** A moderator was
 * handed a laptop to approve photographs for the evening; writing the sentence two
 * hundred people read off a projector is not the same grant, and the same argument
 * `updateEventSettings` makes applies word for word.
 *
 * Two refusals are the interesting ones, and both are rules rather than validation:
 *
 * - **A duplicate prompt is a conflict, not a second row.** The unique index would
 *   refuse it anyway; asking first is what turns a double-tapped "Ajouter" into a
 *   readable `409` rather than a raw SQLite error, and the index is still the thing that
 *   makes it true when two tabs race.
 * - **Twelve is the ceiling**, and it is a product rule about two surfaces — see
 *   `MAX_MISSIONS_PER_EVENT`. Refused here rather than in a schema that cannot express
 *   it, with the number in the error so the console can say what the limit is.
 */

export interface CreateMissionInput {
  readonly eventId: EventId
  readonly actorId: UserId
  /** As the host typed it. `MissionPrompt` decides what survives. */
  readonly prompt: string
  readonly scope: MissionScope
}

export interface CreateMissionDeps {
  readonly events: EventRepository
  readonly missions: MissionRepository
  readonly memberships: MembershipRepository
  readonly ids: IdGenerator
  readonly bus: EventBus
  readonly clock: Clock
}

export type CreateMission = (input: CreateMissionInput) => Promise<Result<Mission, DomainError>>

export const makeCreateMission =
  ({ events, missions, memberships, ids, bus, clock }: CreateMissionDeps): CreateMission =>
  async ({ eventId, actorId, prompt, scope }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const allowed = await requireEventRole(memberships, eventId, actorId, 'manage')
    if (!allowed.ok) return allowed

    const writable = requireWritable(event)
    if (!writable.ok) return writable

    // The archived rule lives in the entity, so the mission list and the event's own
    // fields refuse an archived event for the same reason and in the same words.
    const editable = requireEditable(event)
    if (!editable.ok) return editable

    const parsed = MissionPrompt.create(prompt)
    if (!parsed.ok) return parsed

    if ((await missions.findByPrompt(eventId, parsed.value)) !== null) {
      return err(DomainError.conflict('mission.duplicate'))
    }

    if (!hasRoomForMission(await missions.count(eventId))) {
      return err(DomainError.conflict('mission.limitReached', { max: MAX_MISSIONS_PER_EVENT }))
    }

    const mission = Mission.create(
      { eventId, prompt: parsed.value, scope },
      ids.missionId(),
      clock.now(),
    )

    await missions.save(mission)
    // A projector is showing this list. The signal carries nothing — the wall refetches —
    // so one type covers adding, correcting and removing.
    bus.publish({ type: 'mission.changed', eventId })

    return ok(mission)
  }
