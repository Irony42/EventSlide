import type { GuestRsvp } from '../../domain/guestRsvps/rsvp'
import { isRsvpExpired } from '../../domain/guestRsvps/rsvpExpiry'
import { rsvpRefusalFor } from '../../domain/guestRsvps/rsvpLimits'
import { namesToShow } from '../../domain/guestRsvps/rsvpStats'
import type { EventId, GuestRsvpId, UserId } from '../../domain/shared/ids'
import type {
  GuestRsvpAdmission,
  GuestRsvpAdmitLimits,
  GuestRsvpRepository,
} from '../ports/guestRsvpRepository'

/**
 * In-memory `GuestRsvpRepository`, held to the same contract suite as the SQLite adapter.
 *
 * - **Every lookup is scoped by the event**, a token digest included.
 * - **`admit` runs the same decision** (`rsvpRefusalFor`, the change-or-add rule) the adapter runs
 *   inside its transaction.
 * - **Expiry needs the event's dates**, which live in other tables in SQLite: a test gives them
 *   with {@link FakeGuestRsvpRepository.setEventDates}.
 */

export interface EventDates {
  readonly closedAt: Date | null
  readonly startsAt: Date | null
}

const key = (eventId: EventId, id: GuestRsvpId): string => `${eventId}:${id}`

/** Most recently changed first; the greater id first on a tie, as the adapter's ORDER BY does. */
const newestFirst = (a: GuestRsvp, b: GuestRsvp): number =>
  b.updatedAt.getTime() - a.updatedAt.getTime() || (a.id < b.id ? 1 : -1)

export class FakeGuestRsvpRepository implements GuestRsvpRepository {
  private readonly rows = new Map<string, GuestRsvp>()
  private readonly dates = new Map<string, EventDates>()
  /** `event:user` of every member, with the instant they last saw the replies (or `null`). */
  private readonly members = new Map<string, Date | null>()

  /** Puts rows in without any check, for a test that needs a state the rules would refuse. */
  seed(...rsvps: readonly GuestRsvp[]): this {
    for (const rsvp of rsvps) this.rows.set(key(rsvp.eventId, rsvp.id), rsvp)
    return this
  }

  /** What `events.closed_at` and the invitation's start say, for {@link deleteExpired}. */
  setEventDates(eventId: EventId, dates: EventDates): this {
    this.dates.set(eventId, dates)
    return this
  }

  /** The membership row that `event_memberships` holds in SQLite: only a member has a "seen" instant. */
  addMember(eventId: EventId, userId: UserId): this {
    this.members.set(`${eventId}:${userId}`, null)
    return this
  }

  private inEvent(eventId: EventId): GuestRsvp[] {
    return [...this.rows.values()].filter((row) => row.eventId === eventId)
  }

  async listByEvent(eventId: EventId): Promise<readonly GuestRsvp[]> {
    return this.inEvent(eventId).sort(newestFirst)
  }

  async findById(eventId: EventId, id: GuestRsvpId): Promise<GuestRsvp | null> {
    return this.rows.get(key(eventId, id)) ?? null
  }

  async findByEditTokenHash(eventId: EventId, hash: string): Promise<GuestRsvp | null> {
    return this.inEvent(eventId).find((row) => row.editTokenHash === hash) ?? null
  }

  async findByHousehold(eventId: EventId, householdId: string): Promise<GuestRsvp | null> {
    return this.inEvent(eventId).find((row) => row.householdId === householdId) ?? null
  }

  async admit(rsvp: GuestRsvp, limits: GuestRsvpAdmitLimits): Promise<GuestRsvpAdmission> {
    const held = this.inEvent(rsvp.eventId)
    const existing =
      held.find((row) => row.id === rsvp.id) ??
      (rsvp.householdId === null
        ? undefined
        : held.find((row) => row.householdId === rsvp.householdId))

    if (existing === undefined && limits.changeOnly === true) return { kind: 'gone' }

    const refusal = rsvpRefusalFor({
      isNew: existing === undefined,
      heldInEvent: held.length,
      answer: rsvp.answer,
      people: rsvp.people,
      yesPeopleElsewhere: held
        .filter((row) => row !== existing && row.answer === 'yes')
        .reduce((sum, row) => sum + row.people, 0),
      capacity: limits.capacity,
    })
    if (refusal !== null) return { kind: 'refused', refusal }

    if (existing !== undefined) {
      const changed = existing.withContentOf(rsvp)
      this.rows.set(key(changed.eventId, changed.id), changed)
      return { kind: 'updated', rsvp: changed }
    }
    // The adapter's unique index on the digest holds across events.
    if (
      rsvp.editTokenHash !== null &&
      [...this.rows.values()].some((row) => row.editTokenHash === rsvp.editTokenHash)
    ) {
      throw new Error('UNIQUE constraint failed: guest_rsvps.edit_token_hash')
    }
    this.rows.set(key(rsvp.eventId, rsvp.id), rsvp)
    return { kind: 'added', rsvp }
  }

  async update(rsvp: GuestRsvp): Promise<boolean> {
    const stored = this.rows.get(key(rsvp.eventId, rsvp.id))
    if (stored === undefined) return false
    if (
      rsvp.householdId !== null &&
      this.inEvent(rsvp.eventId).some(
        (row) => row.id !== rsvp.id && row.householdId === rsvp.householdId,
      )
    ) {
      throw new Error('UNIQUE constraint failed: guest_rsvps.event_id, guest_rsvps.household_id')
    }
    // Everything a host may change: the content, and the household. Identity stays.
    this.rows.set(
      key(rsvp.eventId, rsvp.id),
      stored.withContentOf(rsvp).withHousehold(rsvp.householdId),
    )
    return true
  }

  async count(eventId: EventId): Promise<number> {
    return this.inEvent(eventId).length
  }

  async yesPeople(eventId: EventId): Promise<number> {
    return this.inEvent(eventId)
      .filter((row) => row.answer === 'yes')
      .reduce((sum, row) => sum + row.people, 0)
  }

  async showNames(eventId: EventId, limit: number): Promise<readonly string[]> {
    return namesToShow(this.inEvent(eventId)).slice(0, limit)
  }

  async clearShownNames(eventId: EventId): Promise<number> {
    const ticked = this.inEvent(eventId).filter((row) => row.details.showName)
    for (const row of ticked) this.rows.set(key(eventId, row.id), row.withShownNameCleared())
    return ticked.length
  }

  async unseenCount(eventId: EventId, userId: UserId): Promise<number> {
    const seen = this.members.get(`${eventId}:${userId}`)
    if (seen === undefined) return 0
    return this.inEvent(eventId).filter(
      (row) => seen === null || row.updatedAt.getTime() > seen.getTime(),
    ).length
  }

  async markSeen(eventId: EventId, userId: UserId, at: Date): Promise<void> {
    const memberKey = `${eventId}:${userId}`
    if (this.members.has(memberKey)) this.members.set(memberKey, at)
  }

  async delete(eventId: EventId, id: GuestRsvpId): Promise<boolean> {
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
