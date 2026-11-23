import type { GuestHousehold } from '../../domain/guestRsvps/household'
import { MAX_HOUSEHOLDS_PER_EVENT } from '../../domain/guestRsvps/household'
import type { HouseholdToken } from '../../domain/guestRsvps/householdToken'
import { isRsvpExpired } from '../../domain/guestRsvps/rsvpExpiry'
import type { EventId, GuestHouseholdId } from '../../domain/shared/ids'
import type { GuestHouseholdRepository } from '../ports/guestHouseholdRepository'
import type { EventDates } from './fakeGuestRsvpRepository'

/**
 * In-memory `GuestHouseholdRepository`, held to the same contract suite as the SQLite adapter.
 *
 * - **Every lookup is scoped by the event**, a token included.
 * - **`addAll` is all or none**, and the ceiling is decided in the same step.
 * - **Expiry needs the event's dates**, which live in other tables in SQLite: a test gives them
 *   with {@link FakeGuestHouseholdRepository.setEventDates}.
 */

const key = (eventId: EventId, id: GuestHouseholdId): string => `${eventId}:${id}`

/** In the order listed: a paste stamps one instant on every line, so a tie keeps insertion order (the adapter's `rowid`). */
const inListedOrder = (a: GuestHousehold, b: GuestHousehold): number =>
  a.createdAt.getTime() - b.createdAt.getTime()

export class FakeGuestHouseholdRepository implements GuestHouseholdRepository {
  private readonly rows = new Map<string, GuestHousehold>()
  private readonly dates = new Map<string, EventDates>()

  /** Puts rows in without any check, for a test that needs a state the rules would refuse. */
  seed(...households: readonly GuestHousehold[]): this {
    for (const household of households)
      this.rows.set(key(household.eventId, household.id), household)
    return this
  }

  /** What `events.closed_at` and the invitation's start say, for {@link deleteExpired}. */
  setEventDates(eventId: EventId, dates: EventDates): this {
    this.dates.set(eventId, dates)
    return this
  }

  private inEvent(eventId: EventId): GuestHousehold[] {
    return [...this.rows.values()].filter((row) => row.eventId === eventId)
  }

  async listByEvent(eventId: EventId): Promise<readonly GuestHousehold[]> {
    return this.inEvent(eventId).sort(inListedOrder)
  }

  async count(eventId: EventId): Promise<number> {
    return this.inEvent(eventId).length
  }

  async findById(eventId: EventId, id: GuestHouseholdId): Promise<GuestHousehold | null> {
    return this.rows.get(key(eventId, id)) ?? null
  }

  async findByToken(eventId: EventId, token: HouseholdToken): Promise<GuestHousehold | null> {
    return this.inEvent(eventId).find((row) => row.token.equals(token)) ?? null
  }

  async addAll(eventId: EventId, households: readonly GuestHousehold[]): Promise<boolean> {
    if (this.inEvent(eventId).length + households.length > MAX_HOUSEHOLDS_PER_EVENT) return false
    // The adapter's unique index on the token holds across events, and nothing is half written.
    const tokens = new Set([...this.rows.values()].map((row) => row.token.value))
    for (const household of households) {
      if (tokens.has(household.token.value)) {
        throw new Error('UNIQUE constraint failed: guest_households.token')
      }
      tokens.add(household.token.value)
    }
    for (const household of households) this.rows.set(key(eventId, household.id), household)
    return true
  }

  async update(household: GuestHousehold): Promise<boolean> {
    const stored = this.rows.get(key(household.eventId, household.id))
    if (stored === undefined) return false
    this.rows.set(
      key(household.eventId, household.id),
      stored.withInput({ name: household.name, places: household.places }, household.updatedAt),
    )
    return true
  }

  async rotateToken(
    eventId: EventId,
    id: GuestHouseholdId,
    token: HouseholdToken,
    at: Date,
  ): Promise<boolean> {
    const stored = this.rows.get(key(eventId, id))
    if (stored === undefined) return false
    if ([...this.rows.values()].some((row) => row.id !== id && row.token.equals(token))) {
      throw new Error('UNIQUE constraint failed: guest_households.token')
    }
    this.rows.set(key(eventId, id), stored.withToken(token, at))
    return true
  }

  async markReminded(eventId: EventId, id: GuestHouseholdId, at: Date): Promise<boolean> {
    const stored = this.rows.get(key(eventId, id))
    if (stored === undefined) return false
    this.rows.set(key(eventId, id), stored.withReminder(at))
    return true
  }

  async delete(eventId: EventId, id: GuestHouseholdId): Promise<boolean> {
    return this.rows.delete(key(eventId, id))
  }

  async deleteExpired(now: Date): Promise<number> {
    let deleted = 0
    for (const [rowKey, row] of this.rows) {
      const dates = this.dates.get(row.eventId) ?? { closedAt: null, startsAt: null }
      if (isRsvpExpired(dates, now)) {
        this.rows.delete(rowKey)
        deleted += 1
      }
    }
    return deleted
  }
}
