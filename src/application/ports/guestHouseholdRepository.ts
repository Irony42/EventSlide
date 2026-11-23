import type { GuestHousehold } from '../../domain/guestRsvps/household'
import type { HouseholdToken } from '../../domain/guestRsvps/householdToken'
import type { EventId, GuestHouseholdId } from '../../domain/shared/ids'

/**
 * The households of an event's guest list (spec 30, lot 3).
 *
 * Every method takes `eventId` first and no query answers with another event's household: a
 * household id arrives in a host's URL and a token arrives from the public, so a lookup by either
 * alone would be a way across events (CLAUDE.md section 3, rule 5). There is deliberately no
 * `findById(id)` and no `findByToken(token)`.
 *
 * The token is stored **in the clear** (ADR 0017): the host shows the link again.
 */
export interface GuestHouseholdRepository {
  /** An event's households, in the order they were listed (a paste's lines keep their order). */
  listByEvent(eventId: EventId): Promise<readonly GuestHousehold[]>

  /** How many households the event holds (a narrow read for the ceiling). */
  count(eventId: EventId): Promise<number>

  findById(eventId: EventId, id: GuestHouseholdId): Promise<GuestHousehold | null>

  /** The household of the event whose link this is. A token valid elsewhere finds nothing. */
  findByToken(eventId: EventId, token: HouseholdToken): Promise<GuestHousehold | null>

  /**
   * Stores households **all or none**, deciding the 500-household ceiling inside one write
   * transaction: `false` (nothing written) when the event would hold more than `MAX_HOUSEHOLDS_PER_EVENT`.
   * Every household must be the event's `eventId`. A token another household holds is a bug (80
   * random bits colliding): it throws.
   */
  addAll(eventId: EventId, households: readonly GuestHousehold[]): Promise<boolean>

  /**
   * Replaces the **name, places and `updatedAt`** of a household and nothing else (not the token,
   * the reminder or the creation). Says whether such a household existed.
   */
  update(household: GuestHousehold): Promise<boolean>

  /** Replaces the token and `updatedAt`: the old link stops at once. Says whether it existed. */
  rotateToken(
    eventId: EventId,
    id: GuestHouseholdId,
    token: HouseholdToken,
    at: Date,
  ): Promise<boolean>

  /** Notes the host's reminder (`reminded_at` and `updatedAt`). Says whether it existed. */
  markReminded(eventId: EventId, id: GuestHouseholdId, at: Date): Promise<boolean>

  /**
   * Whether a household was deleted. **In the same write transaction** the reply filed under it,
   * if any, is detached (`household_id` back to `NULL`) and kept: the household is gone first, so
   * no answer can be filed under it afterwards, and no reply is ever left pointing at a household
   * that no longer exists. Another event's reply is never touched.
   */
  delete(eventId: EventId, id: GuestHouseholdId): Promise<boolean>

  /**
   * Deletes the households whose event has expired (the replies' own rule, `isRsvpExpired`) and
   * says how many. The purge hold does not keep them.
   */
  deleteExpired(now: Date): Promise<number>
}
