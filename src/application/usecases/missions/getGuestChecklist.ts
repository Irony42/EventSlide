import { isDoneForGuest } from '../../../domain/missions/missionProgress'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventRepository } from '../../ports/eventRepository'
import type { MissionRepository, MissionWithProgress } from '../../ports/missionRepository'

/**
 * The guest's checklist: the host's prompts, and which of them *this* guest has left.
 *
 * The whole feature in one read, and it is deliberately one read: a guest has one thumb,
 * a saturated access point and well under a minute of patience, so the screen that says
 * "there is something to do" cannot be two round trips and cannot be a request per row.
 *
 * `done` is the only thing here that is not a straight copy, and it is the one rule
 * `MissionScope` exists for — see `isDoneForGuest`. Applying it here rather than in a
 * presenter is what keeps the answer the same on the phone and in a test.
 *
 * Note what is **not** returned: no photograph, no photo ids, no gallery. A mission's
 * photographs are ordinary photographs and are already listed by `listGuestPhotos`;
 * §2.1 says they stay that way, and a second list of them here is the second gallery it
 * warns against.
 */

export interface GetGuestChecklistInput {
  readonly eventId: EventId
  readonly guestId: GuestId
}

export interface ChecklistItem extends MissionWithProgress {
  /** Whether this guest still has something to do about this prompt. */
  readonly done: boolean
}

export interface GetGuestChecklistDeps {
  readonly events: EventRepository
  readonly missions: MissionRepository
}

export type GetGuestChecklist = (
  input: GetGuestChecklistInput,
) => Promise<Result<readonly ChecklistItem[], DomainError>>

export const makeGetGuestChecklist =
  ({ events, missions }: GetGuestChecklistDeps): GetGuestChecklist =>
  async ({ eventId, guestId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const listed = await missions.listWithProgress(eventId)
    // Skipped entirely when the host has set no prompts, which is most events: the
    // checklist is then empty and there is nothing to ask the second question about.
    if (listed.length === 0) return ok([])

    const mine = await missions.completedByGuest(eventId, guestId)

    return ok(
      listed.map((row) => ({
        ...row,
        done: isDoneForGuest(row.mission.scope, row.progress, mine.has(row.mission.id)),
      })),
    )
  }
