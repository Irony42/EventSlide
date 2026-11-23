import type { GuestHouseholdRepository } from '../../application/ports/guestHouseholdRepository'
import { GuestHousehold, MAX_HOUSEHOLDS_PER_EVENT } from '../../domain/guestRsvps/household'
import { HouseholdToken } from '../../domain/guestRsvps/householdToken'
import { rsvpCutoffs } from '../../domain/guestRsvps/rsvpExpiry'
import {
  asEventId,
  asGuestHouseholdId,
  type EventId,
  type GuestHouseholdId,
} from '../../domain/shared/ids'
import type { Db } from './connection'
import { fromIsoText, toIsoText } from './rowMapping'

/**
 * `guest_households` (spec 30, lot 3): one row per household, every statement scoped by
 * `event_id`. The token is stored in the clear (ADR 0017). `moments` (lot 4) is not read or
 * written here yet: no statement names it, so it stays as it is.
 */

const COLUMNS = `id, event_id, token, name, places, reminded_at, created_at, updated_at`

interface HouseholdRow {
  readonly id: string
  readonly event_id: string
  readonly token: string
  readonly name: string
  readonly places: number
  readonly reminded_at: string | null
  readonly created_at: string
  readonly updated_at: string
}

const toHousehold = (row: HouseholdRow): GuestHousehold => {
  const token = HouseholdToken.create(row.token)
  // A stored token is one this code minted: anything else is a corrupt row, not a state to model.
  if (!token.ok) throw new Error(`guest_households ${row.id} holds a malformed token`)
  return GuestHousehold.restore({
    id: asGuestHouseholdId(row.id),
    eventId: asEventId(row.event_id),
    token: token.value,
    name: row.name,
    places: row.places,
    remindedAt: row.reminded_at === null ? null : fromIsoText(row.reminded_at),
    createdAt: fromIsoText(row.created_at),
    updatedAt: fromIsoText(row.updated_at),
  })
}

export class SqliteGuestHouseholdRepository implements GuestHouseholdRepository {
  constructor(private readonly db: Db) {}

  async listByEvent(eventId: EventId): Promise<readonly GuestHousehold[]> {
    // `rowid` breaks a tie: a paste stamps one instant on every line and keeps its order.
    return this.db
      .prepare<[string], HouseholdRow>(
        `SELECT ${COLUMNS} FROM guest_households WHERE event_id = ? ORDER BY created_at ASC, rowid ASC`,
      )
      .all(eventId)
      .map(toHousehold)
  }

  async count(eventId: EventId): Promise<number> {
    const row = this.db
      .prepare<[string], { readonly n: number }>(
        `SELECT COUNT(*) AS n FROM guest_households WHERE event_id = ?`,
      )
      .get(eventId)
    return row?.n ?? 0
  }

  async findById(eventId: EventId, id: GuestHouseholdId): Promise<GuestHousehold | null> {
    const row = this.db
      .prepare<[string, string], HouseholdRow>(
        `SELECT ${COLUMNS} FROM guest_households WHERE event_id = ? AND id = ?`,
      )
      .get(eventId, id)
    return row === undefined ? null : toHousehold(row)
  }

  async findByToken(eventId: EventId, token: HouseholdToken): Promise<GuestHousehold | null> {
    const row = this.db
      .prepare<[string, string], HouseholdRow>(
        `SELECT ${COLUMNS} FROM guest_households WHERE event_id = ? AND token = ?`,
      )
      .get(eventId, token.value)
    return row === undefined ? null : toHousehold(row)
  }

  async addAll(eventId: EventId, households: readonly GuestHousehold[]): Promise<boolean> {
    const countAll = this.db.prepare<[string], { readonly n: number }>(
      `SELECT COUNT(*) AS n FROM guest_households WHERE event_id = ?`,
    )
    const insert = this.db.prepare(
      `INSERT INTO guest_households (${COLUMNS})
            VALUES (@id, @event_id, @token, @name, @places, @reminded_at, @created_at, @updated_at)`,
    )
    // One write transaction, taken up front: the count is the last committed state and nothing
    // can commit between it and the inserts, so the ceiling holds when requests overlap, and a
    // failing row (a token collision) takes the whole paste back with it.
    return this.db
      .transaction((): boolean => {
        if ((countAll.get(eventId)?.n ?? 0) + households.length > MAX_HOUSEHOLDS_PER_EVENT) {
          return false
        }
        for (const household of households) {
          insert.run({
            id: household.id,
            event_id: eventId,
            token: household.token.value,
            name: household.name,
            places: household.places,
            reminded_at: household.remindedAt === null ? null : toIsoText(household.remindedAt),
            created_at: toIsoText(household.createdAt),
            updated_at: toIsoText(household.updatedAt),
          })
        }
        return true
      })
      .immediate()
  }

  async update(household: GuestHousehold): Promise<boolean> {
    return (
      this.db
        .prepare(
          `UPDATE guest_households SET name = @name, places = @places, updated_at = @updated_at
            WHERE event_id = @event_id AND id = @id`,
        )
        .run({
          event_id: household.eventId,
          id: household.id,
          name: household.name,
          places: household.places,
          updated_at: toIsoText(household.updatedAt),
        }).changes > 0
    )
  }

  async rotateToken(
    eventId: EventId,
    id: GuestHouseholdId,
    token: HouseholdToken,
    at: Date,
  ): Promise<boolean> {
    return (
      this.db
        .prepare<[string, string, string, string]>(
          `UPDATE guest_households SET token = ?, updated_at = ? WHERE event_id = ? AND id = ?`,
        )
        .run(token.value, toIsoText(at), eventId, id).changes > 0
    )
  }

  async markReminded(eventId: EventId, id: GuestHouseholdId, at: Date): Promise<boolean> {
    return (
      this.db
        .prepare<[string, string, string, string]>(
          `UPDATE guest_households SET reminded_at = ?, updated_at = ? WHERE event_id = ? AND id = ?`,
        )
        .run(toIsoText(at), toIsoText(at), eventId, id).changes > 0
    )
  }

  async delete(eventId: EventId, id: GuestHouseholdId): Promise<boolean> {
    const remove = this.db.prepare<[string, string]>(
      `DELETE FROM guest_households WHERE event_id = ? AND id = ?`,
    )
    const detach = this.db.prepare<[string, string]>(
      `UPDATE guest_rsvps SET household_id = NULL WHERE event_id = ? AND household_id = ?`,
    )
    // One write transaction: the household goes first, then its reply is detached, so a reply is
    // never left pointing at a household that no longer exists (and nothing can file one under it).
    return this.db
      .transaction((): boolean => {
        if (remove.run(eventId, id).changes === 0) return false
        detach.run(eventId, id)
        return true
      })
      .immediate()
  }

  async deleteExpired(now: Date): Promise<number> {
    // The replies' own cutoffs (`rsvpExpiry.ts`), so the two sweeps cannot disagree.
    const { closedBy, startedBy } = rsvpCutoffs(now)
    return this.db
      .prepare<[string, string]>(
        `DELETE FROM guest_households
          WHERE event_id IN (
            SELECT e.id FROM events e
              LEFT JOIN guest_invites g ON g.event_id = e.id
             WHERE (e.closed_at IS NOT NULL AND e.closed_at <= ?)
                OR (g.starts_at IS NOT NULL AND g.starts_at <= ?))`,
      )
      .run(toIsoText(closedBy), toIsoText(startedBy)).changes
  }
}
