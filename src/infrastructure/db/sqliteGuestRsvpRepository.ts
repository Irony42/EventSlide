import {
  GuestRsvp,
  restoreRsvpDetails,
  type RsvpAnswer,
  type RsvpSource,
} from '../../domain/guestRsvps/rsvp'
import { rsvpCutoffs } from '../../domain/guestRsvps/rsvpExpiry'
import { rsvpAdmissionFor } from '../../domain/guestRsvps/rsvpLimits'
import {
  asEventId,
  asGuestRsvpId,
  type EventId,
  type GuestRsvpId,
  type UserId,
} from '../../domain/shared/ids'
import type {
  GuestRsvpAdmission,
  GuestRsvpAdmitLimits,
  GuestRsvpRepository,
} from '../../application/ports/guestRsvpRepository'
import type { Db } from './connection'
import { fromIsoText, toIsoText } from './rowMapping'

/**
 * `guest_rsvps` (spec 30): one row per reply, every statement scoped by `event_id`.
 *
 * `details` is JSON read back through `restoreRsvpDetails`, which never fails: a piece a later
 * rule refuses becomes empty rather than making the host's list vanish.
 */

/** What a reply reads back. The insert names its own list: `absent_note_guest_id` is never written by an admission. */
const COLUMNS = `id, event_id, household_id, edit_token_hash, name, answer, adults, kids, details,
                 diet, message, source, created_at, updated_at`
const READ_COLUMNS = `${COLUMNS}, absent_note_guest_id`

interface RsvpRow {
  readonly id: string
  readonly event_id: string
  readonly household_id: string | null
  readonly edit_token_hash: string | null
  readonly name: string
  readonly answer: string
  readonly adults: number
  readonly kids: number
  readonly details: string | null
  readonly diet: string | null
  readonly message: string | null
  readonly source: string
  readonly created_at: string
  readonly updated_at: string
  readonly absent_note_guest_id: string | null
}

/** The column carries `CHECK (json_valid(details))`, so a stored text always parses. */
const parseDetails = (text: string | null): unknown =>
  text === null ? null : (JSON.parse(text) as unknown)

const toRsvp = (row: RsvpRow): GuestRsvp =>
  GuestRsvp.restore({
    id: asGuestRsvpId(row.id),
    eventId: asEventId(row.event_id),
    householdId: row.household_id,
    editTokenHash: row.edit_token_hash,
    name: row.name,
    // The CHECK constraints keep these vocabularies closed.
    answer: row.answer as RsvpAnswer,
    adults: row.adults,
    kids: row.kids,
    details: restoreRsvpDetails(parseDetails(row.details)),
    diet: row.diet,
    message: row.message,
    source: row.source as RsvpSource,
    createdAt: fromIsoText(row.created_at),
    updatedAt: fromIsoText(row.updated_at),
    absentNoteGuestId: row.absent_note_guest_id,
  })

const contentParams = (rsvp: GuestRsvp) => ({
  name: rsvp.name,
  answer: rsvp.answer,
  adults: rsvp.adults,
  kids: rsvp.kids,
  details: JSON.stringify(rsvp.details),
  diet: rsvp.diet,
  message: rsvp.message,
  updated_at: toIsoText(rsvp.updatedAt),
})

export class SqliteGuestRsvpRepository implements GuestRsvpRepository {
  constructor(private readonly db: Db) {}

  async listByEvent(eventId: EventId): Promise<readonly GuestRsvp[]> {
    return this.db
      .prepare<[string], RsvpRow>(
        `SELECT ${READ_COLUMNS} FROM guest_rsvps WHERE event_id = ? ORDER BY updated_at DESC, id DESC`,
      )
      .all(eventId)
      .map(toRsvp)
  }

  async count(eventId: EventId): Promise<number> {
    const row = this.db
      .prepare<[string], { readonly n: number }>(
        `SELECT COUNT(*) AS n FROM guest_rsvps WHERE event_id = ?`,
      )
      .get(eventId)
    return row?.n ?? 0
  }

  async yesPeople(eventId: EventId): Promise<number> {
    const row = this.db
      .prepare<[string], { readonly n: number }>(
        `SELECT COALESCE(SUM(adults + kids), 0) AS n FROM guest_rsvps
          WHERE event_id = ? AND answer = 'yes'`,
      )
      .get(eventId)
    return row?.n ?? 0
  }

  async showNames(eventId: EventId, limit: number): Promise<readonly string[]> {
    // The ordering of `namesToShow`: oldest first, the smaller id on a tie. `details` is JSON.
    return this.db
      .prepare<[string, number], { readonly name: string }>(
        `SELECT name FROM guest_rsvps
          WHERE event_id = ? AND answer = 'yes' AND json_extract(details, '$.showName') = 1
          ORDER BY created_at ASC, id ASC LIMIT ?`,
      )
      .all(eventId, limit)
      .map((row) => row.name)
  }

  async clearShownNames(eventId: EventId): Promise<number> {
    // One statement: a reply is never half-cleared, and `updated_at` stays what it was.
    return this.db
      .prepare<[string]>(
        `UPDATE guest_rsvps SET details = json_set(details, '$.showName', json('false'))
          WHERE event_id = ? AND json_extract(details, '$.showName') = 1`,
      )
      .run(eventId).changes
  }

  async findById(eventId: EventId, id: GuestRsvpId): Promise<GuestRsvp | null> {
    const row = this.db
      .prepare<[string, string], RsvpRow>(
        `SELECT ${READ_COLUMNS} FROM guest_rsvps WHERE event_id = ? AND id = ?`,
      )
      .get(eventId, id)
    return row === undefined ? null : toRsvp(row)
  }

  async findByEditTokenHash(eventId: EventId, hash: string): Promise<GuestRsvp | null> {
    const row = this.db
      .prepare<[string, string], RsvpRow>(
        `SELECT ${READ_COLUMNS} FROM guest_rsvps WHERE event_id = ? AND edit_token_hash = ?`,
      )
      .get(eventId, hash)
    return row === undefined ? null : toRsvp(row)
  }

  async findByHousehold(eventId: EventId, householdId: string): Promise<GuestRsvp | null> {
    const row = this.db
      .prepare<[string, string], RsvpRow>(
        `SELECT ${READ_COLUMNS} FROM guest_rsvps WHERE event_id = ? AND household_id = ?
          ORDER BY updated_at DESC, id DESC LIMIT 1`,
      )
      .get(eventId, householdId)
    return row === undefined ? null : toRsvp(row)
  }

  async admit(rsvp: GuestRsvp, limits: GuestRsvpAdmitLimits): Promise<GuestRsvpAdmission> {
    const byId = this.db.prepare<[string, string], RsvpRow>(
      `SELECT ${READ_COLUMNS} FROM guest_rsvps WHERE event_id = ? AND id = ?`,
    )
    const byHousehold = this.db.prepare<[string, string], RsvpRow>(
      `SELECT ${READ_COLUMNS} FROM guest_rsvps WHERE event_id = ? AND household_id = ?
        ORDER BY updated_at DESC, id DESC LIMIT 1`,
    )
    const countAll = this.db.prepare<[string], { readonly n: number }>(
      `SELECT COUNT(*) AS n FROM guest_rsvps WHERE event_id = ?`,
    )
    const yesPeopleExcept = this.db.prepare<[string, string], { readonly n: number }>(
      `SELECT COALESCE(SUM(adults + kids), 0) AS n FROM guest_rsvps
        WHERE event_id = ? AND answer = 'yes' AND id <> ?`,
    )
    const insert = this.db.prepare(
      `INSERT INTO guest_rsvps (${COLUMNS})
            VALUES (@id, @event_id, @household_id, @edit_token_hash, @name, @answer, @adults, @kids,
                    @details, @diet, @message, @source, @created_at, @updated_at)`,
    )
    const change = this.db.prepare(
      `UPDATE guest_rsvps
          SET name = @name, answer = @answer, adults = @adults, kids = @kids, details = @details,
              diet = @diet, message = @message, updated_at = @updated_at
        WHERE event_id = @event_id AND id = @id`,
    )

    // One write transaction, taken up front (`immediate`): the counts below are the last
    // committed state and nothing can commit between them and the write, which is what makes the
    // ceilings hold when requests overlap. better-sqlite3 is synchronous: no `await` inside.
    return this.db
      .transaction((): GuestRsvpAdmission => {
        const found =
          byId.get(rsvp.eventId, rsvp.id) ??
          (rsvp.householdId === null ? undefined : byHousehold.get(rsvp.eventId, rsvp.householdId))
        const existing = found === undefined ? undefined : toRsvp(found)
        if (existing === undefined && limits.changeOnly === true) return { kind: 'gone' }

        const decision = rsvpAdmissionFor({
          isNew: existing === undefined,
          heldInEvent: countAll.get(rsvp.eventId)?.n ?? 0,
          answer: rsvp.answer,
          heldAnswer: existing?.answer ?? null,
          heldPeople: existing?.answer === 'yes' ? existing.people : 0,
          people: rsvp.people,
          // `id <> ?` with an id no row has (a new reply) excludes nothing, as it must.
          yesPeopleElsewhere: yesPeopleExcept.get(rsvp.eventId, existing?.id ?? rsvp.id)?.n ?? 0,
          capacity: limits.capacity,
        })
        if (decision === 'tooMany' || decision === 'full') {
          return { kind: 'refused', refusal: decision }
        }
        // A yes the places cannot hold is stored as a waiting-list entry: it takes no place.
        const stored = decision === 'waitlist' ? rsvp.withAnswer('waitlist') : rsvp

        if (existing !== undefined) {
          change.run({ event_id: existing.eventId, id: existing.id, ...contentParams(stored) })
          return { kind: 'updated', rsvp: existing.withContentOf(stored) }
        }
        insert.run({
          id: rsvp.id,
          event_id: rsvp.eventId,
          household_id: rsvp.householdId,
          edit_token_hash: rsvp.editTokenHash,
          source: rsvp.source,
          created_at: toIsoText(rsvp.createdAt),
          ...contentParams(stored),
        })
        return { kind: 'added', rsvp: stored }
      })
      .immediate()
  }

  /** Content, household and `updated_at`: the statement names neither the token, the source nor the creation. */
  async update(rsvp: GuestRsvp): Promise<boolean> {
    const result = this.db
      .prepare(
        `UPDATE guest_rsvps
            SET household_id = @household_id, name = @name, answer = @answer, adults = @adults,
                kids = @kids, details = @details, diet = @diet, message = @message,
                updated_at = @updated_at
          WHERE event_id = @event_id AND id = @id`,
      )
      .run({
        event_id: rsvp.eventId,
        id: rsvp.id,
        household_id: rsvp.householdId,
        ...contentParams(rsvp),
      })
    return result.changes > 0
  }

  async setHousehold(
    eventId: EventId,
    id: GuestRsvpId,
    householdId: string | null,
  ): Promise<'set' | 'taken' | 'gone'> {
    const exists = this.db.prepare<[string, string], { readonly id: string }>(
      `SELECT id FROM guest_rsvps WHERE event_id = ? AND id = ?`,
    )
    const taken = this.db.prepare<[string, string, string], { readonly id: string }>(
      `SELECT id FROM guest_rsvps WHERE event_id = ? AND household_id = ? AND id <> ?`,
    )
    const set = this.db.prepare<[string | null, string, string]>(
      `UPDATE guest_rsvps SET household_id = ? WHERE event_id = ? AND id = ?`,
    )
    // One write transaction: the check and the write cannot be split by another reply (the
    // partial unique index is the last line, this is the answer a caller can read).
    return this.db
      .transaction((): 'set' | 'taken' | 'gone' => {
        if (exists.get(eventId, id) === undefined) return 'gone'
        if (householdId !== null && taken.get(eventId, householdId, id) !== undefined) {
          return 'taken'
        }
        set.run(householdId, eventId, id)
        return 'set'
      })
      .immediate()
  }

  async unseenCount(eventId: EventId, userId: UserId): Promise<number> {
    // No membership, no "seen" instant to count from, and no badge to show: none.
    const row = this.db
      .prepare<[string, string, string, string, string], { readonly n: number }>(
        `SELECT COUNT(*) AS n FROM guest_rsvps r
          WHERE r.event_id = ?
            AND EXISTS (SELECT 1 FROM event_memberships m WHERE m.event_id = ? AND m.user_id = ?)
            AND r.updated_at > COALESCE(
                  (SELECT m.rsvp_seen_at FROM event_memberships m
                    WHERE m.event_id = ? AND m.user_id = ?), '')`,
      )
      .get(eventId, eventId, userId, eventId, userId)
    return row?.n ?? 0
  }

  async markSeen(eventId: EventId, userId: UserId, at: Date): Promise<void> {
    this.db
      .prepare<[string, string, string]>(
        `UPDATE event_memberships SET rsvp_seen_at = ? WHERE event_id = ? AND user_id = ?`,
      )
      .run(toIsoText(at), eventId, userId)
  }

  async delete(eventId: EventId, id: GuestRsvpId): Promise<boolean> {
    // The reply and the `guests` row made for its note go in one transaction (the entry goes with that
    // row, `ON DELETE CASCADE`): erasing a reply erases what the guest left with it.
    const note = this.db.prepare<[string, string], { readonly guest: string | null }>(
      `SELECT absent_note_guest_id AS guest FROM guest_rsvps WHERE event_id = ? AND id = ?`,
    )
    const dropNote = this.db.prepare<[string, string]>(
      `DELETE FROM guests WHERE event_id = ? AND id = ? AND via_rsvp = 1`,
    )
    const dropReply = this.db.prepare<[string, string]>(
      `DELETE FROM guest_rsvps WHERE event_id = ? AND id = ?`,
    )
    return this.db
      .transaction((): boolean => {
        const guest = note.get(eventId, id)?.guest ?? null
        if (guest !== null) dropNote.run(eventId, guest)
        return dropReply.run(eventId, id).changes > 0
      })
      .immediate()
  }

  async claimAbsentNote(eventId: EventId, id: GuestRsvpId, guestId: string): Promise<boolean> {
    return (
      this.db
        .prepare<[string, string, string]>(
          `UPDATE guest_rsvps SET absent_note_guest_id = ?
            WHERE event_id = ? AND id = ? AND answer = 'no' AND absent_note_guest_id IS NULL`,
        )
        .run(guestId, eventId, id).changes > 0
    )
  }

  async releaseAbsentNote(eventId: EventId, id: GuestRsvpId, guestId: string): Promise<void> {
    this.db
      .prepare<[string, string, string]>(
        `UPDATE guest_rsvps SET absent_note_guest_id = NULL
          WHERE event_id = ? AND id = ? AND absent_note_guest_id = ?`,
      )
      .run(eventId, id, guestId)
  }

  async eventsWithExpiredNotes(now: Date): Promise<readonly EventId[]> {
    const { closedBy, startedBy } = rsvpCutoffs(now)
    return this.db
      .prepare<[string, string], { readonly event_id: string }>(
        `SELECT DISTINCT event_id FROM guest_rsvps
          WHERE absent_note_guest_id IS NOT NULL
            AND event_id IN (
              SELECT e.id FROM events e
                LEFT JOIN guest_invites g ON g.event_id = e.id
               WHERE (e.closed_at IS NOT NULL AND e.closed_at <= ?)
                  OR (g.starts_at IS NOT NULL AND g.starts_at <= ?))
          ORDER BY event_id`,
      )
      .all(toIsoText(closedBy), toIsoText(startedBy))
      .map((row) => asEventId(row.event_id))
  }

  async eventsWithRepliesExpiringBefore(horizon: Date): Promise<readonly EventId[]> {
    // The same cutoffs as `deleteExpired`, moved to the horizon: expiry at or before it.
    const { closedBy, startedBy } = rsvpCutoffs(horizon)
    return this.db
      .prepare<[string, string], { readonly event_id: string }>(
        `SELECT DISTINCT event_id FROM guest_rsvps
          WHERE event_id IN (
              SELECT e.id FROM events e
                LEFT JOIN guest_invites g ON g.event_id = e.id
               WHERE (e.closed_at IS NOT NULL AND e.closed_at <= ?)
                  OR (g.starts_at IS NOT NULL AND g.starts_at <= ?))
          ORDER BY event_id`,
      )
      .all(toIsoText(closedBy), toIsoText(startedBy))
      .map((row) => asEventId(row.event_id))
  }

  async deleteExpired(now: Date): Promise<number> {
    // The two cutoffs come from the domain rule (`rsvpExpiry.ts`), so SQL cannot disagree with it.
    // `closed_at` and `starts_at` are ISO `toISOString()` text, fixed-width UTC, so comparing them
    // as TEXT orders them as instants. Do not store another format in either column.
    const { closedBy, startedBy } = rsvpCutoffs(now)
    const expired = `event_id IN (
            SELECT e.id FROM events e
              LEFT JOIN guest_invites g ON g.event_id = e.id
             WHERE (e.closed_at IS NOT NULL AND e.closed_at <= ?)
                OR (g.starts_at IS NOT NULL AND g.starts_at <= ?))`
    // The notes of the expired replies go first (their `guests` rows, and the entries with them), in the
    // same transaction as the replies: the sweep erases what the guests left with their replies too.
    const dropNotes = this.db.prepare<[string, string]>(
      `DELETE FROM guests WHERE via_rsvp = 1 AND id IN (
         SELECT absent_note_guest_id FROM guest_rsvps
          WHERE absent_note_guest_id IS NOT NULL AND ${expired})`,
    )
    const dropReplies = this.db.prepare<[string, string]>(
      `DELETE FROM guest_rsvps WHERE ${expired}`,
    )
    return this.db
      .transaction((): number => {
        dropNotes.run(toIsoText(closedBy), toIsoText(startedBy))
        return dropReplies.run(toIsoText(closedBy), toIsoText(startedBy)).changes
      })
      .immediate()
  }
}
