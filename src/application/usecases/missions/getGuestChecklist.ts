import { isDoneForGuest } from '../../../domain/missions/missionProgress'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ChallengeRepository } from '../../ports/challengeRepository'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { MissionRepository, MissionWithProgress } from '../../ports/missionRepository'
import { readChallenge, type ChallengeReading } from '../challenges/readChallenge'

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
  readonly challenges: ChallengeRepository
  readonly clock: Clock
}

/**
 * The checklist and, beside it, the timed challenge the host launched (spec 10), with the server's
 * clock so the phone counts down with the wall. Since spec 18 a challenge has its own text and
 * needs no mission, so it is read even when the list is empty.
 */
export interface GuestChecklist {
  readonly items: readonly ChecklistItem[]
  readonly challenge: ChallengeReading | null
  readonly serverNowMs: number
}

export type GetGuestChecklist = (
  input: GetGuestChecklistInput,
) => Promise<Result<GuestChecklist, DomainError>>

export const makeGetGuestChecklist =
  ({ events, missions, challenges, clock }: GetGuestChecklistDeps): GetGuestChecklist =>
  async ({ eventId, guestId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const now = clock.now()
    const serverNowMs = now.getTime()
    const listed = await missions.listWithProgress(eventId)
    // The challenge is read whatever the list holds (spec 18): it has its own text and needs no
    // mission, so an event with no prompts can still run one.
    const challenge = await readChallenge(challenges, eventId, now)
    // Skipped when the host has set no prompts, which is most events: there is nothing to ask
    // the second question about.
    if (listed.length === 0) return ok({ items: [], challenge, serverNowMs })

    const mine = await missions.completedByGuest(eventId, guestId)

    return ok({
      items: listed.map((row) => ({
        ...row,
        done: isDoneForGuest(row.mission.scope, row.progress, mine.has(row.mission.id)),
      })),
      challenge,
      serverNowMs,
    })
  }
