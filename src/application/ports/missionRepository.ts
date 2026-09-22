import type { Mission } from '../../domain/missions/mission'
import type { MissionProgress } from '../../domain/missions/missionProgress'
import type { MissionPrompt } from '../../domain/missions/missionPrompt'
import type { EventId, GuestId, MissionId } from '../../domain/shared/ids'

/**
 * The host's list of prompts, and what the photographs say about each of them.
 *
 * Every method takes `eventId` first, like every other event-scoped port here. It
 * matters more than usual on this one: a mission id is **guest-supplied** — a phone
 * sends it back on an upload — so a lookup that could answer with another event's row
 * would let a guest at one wedding file a photograph under a stranger's prompt, and the
 * wall of a wedding nobody at this one is attending would count it. There is
 * deliberately no `findById(missionId)`.
 */

/** One row of the host's list, with the counts that decide whether it is answered. */
export interface MissionWithProgress {
  readonly mission: Mission
  readonly progress: MissionProgress
}

export interface MissionRepository {
  findById(eventId: EventId, missionId: MissionId): Promise<Mission | null>

  /**
   * The uniqueness lookup behind `(event_id, prompt)`.
   *
   * A mission rather than a boolean, because both callers need the row: creating asks
   * "is this the same prompt the host already added", and editing asks "is this somebody
   * *else's* row", which needs an id to compare. `MissionPrompt` has already normalised
   * whitespace, so this is an exact match on the same value the index holds.
   */
  findByPrompt(eventId: EventId, prompt: MissionPrompt): Promise<Mission | null>

  /**
   * The whole list with its counts, in the host's own order, in one read.
   *
   * One method rather than a list plus a per-mission count, because this is what the
   * wall asks for on every refresh for eight hours: the counts come from one grouped
   * scan of a covering index rather than from a query per row.
   */
  listWithProgress(eventId: EventId): Promise<readonly MissionWithProgress[]>

  /**
   * Which missions **this guest** has personally answered — their own published
   * photographs, and nobody else's.
   *
   * Separate from the counts above because it is a different question with a different
   * answer per caller: the room's view is one read shared by every projector, and this
   * is one read per phone. Folding them into a nullable-guest parameter would make the
   * wall pay for a branch it never takes.
   */
  completedByGuest(eventId: EventId, guestId: GuestId): Promise<ReadonlySet<MissionId>>

  /** How many prompts this event holds. Drives the ceiling in `hasRoomForMission`. */
  count(eventId: EventId): Promise<number>

  /** Insert or update. A mission is small and is written one at a time by one host. */
  save(mission: Mission): Promise<void>

  /**
   * Idempotent, like every other delete here.
   *
   * Removing a mission **unfiles** the photographs that named it and removes none of
   * them — the schema says so with `ON DELETE SET NULL`, and the contract suite asserts
   * it against both implementations, because a fake that cascaded where SQLite unfiles
   * would let a ring-2 test prove the opposite of what production does.
   */
  delete(eventId: EventId, missionId: MissionId): Promise<void>
}
