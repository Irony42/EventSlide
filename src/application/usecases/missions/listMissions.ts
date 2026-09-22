import { canModerate } from '../../../domain/events/eventRole'
import { isAchieved } from '../../../domain/missions/missionProgress'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventRepository } from '../../ports/eventRepository'
import type { MissionRepository, MissionWithProgress } from '../../ports/missionRepository'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * The host's own view of the list: every prompt, and how the room is answering it.
 *
 * **Moderator, where every other mission use case is owner.** Reading is not editing: a
 * moderator standing at a laptop mid-evening is exactly the person who wants to know
 * that nobody has photographed the cake yet, and telling them costs the event nothing.
 * Writing the sentence on the projector stays the owner's.
 *
 * Unlike the three that write, this is not refused on an archived event. The list is
 * then a record of what the evening asked for, which is what an archived event is.
 */

export interface ListMissionsInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface MissionSummary extends MissionWithProgress {
  /** Whether the room has seen it answered at all. See `isAchieved`. */
  readonly achieved: boolean
}

export interface ListMissionsDeps {
  readonly events: EventRepository
  readonly missions: MissionRepository
  readonly memberships: MembershipRepository
}

export type ListMissions = (
  input: ListMissionsInput,
) => Promise<Result<readonly MissionSummary[], DomainError>>

export const makeListMissions =
  ({ events, missions, memberships }: ListMissionsDeps): ListMissions =>
  async ({ eventId, actorId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    // One condition rather than two, which is the shape `moderatePhoto` already has and
    // for the same two reasons. A signed-in user with no part in this event is answered
    // exactly as one asking about an event that does not exist, so this cannot be used to
    // discover other people's weddings — and `canModerate` is *asked* rather than the
    // qualifying roles being listed, so a role added later is refused by default. Both
    // roles moderate today, so the second half is a guard against a future rather than a
    // branch this event can take.
    const role = await memberships.roleFor(eventId, actorId)
    if (role === null || !canModerate(role)) return err(DomainError.notFound('event.notFound'))

    const listed = await missions.listWithProgress(eventId)

    return ok(listed.map((row) => ({ ...row, achieved: isAchieved(row.progress) })))
  }
