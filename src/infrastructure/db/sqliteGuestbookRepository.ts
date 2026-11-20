import {
  isWritten,
  type EntryStatus,
  type GuestbookEntry,
  type WrittenGuestbookEntry,
} from '../../domain/guestbook/guestbookEntry'
import { DUPLICATE_WINDOW_MS, guestbookRefusalFor } from '../../domain/guestbook/guestbookLimits'
import {
  asEventId,
  type EventId,
  type GuestId,
  type GuestbookEntryId,
} from '../../domain/shared/ids'
import type {
  GuestbookAdmission,
  GuestbookLocation,
  GuestbookRepository,
} from '../../application/ports/guestbookRepository'
import type { Db } from './connection'
import {
  ENTRY_COLUMNS,
  ENTRY_FROM,
  HOLDS_A_PLACE,
  toEntry,
  type EntryRow,
} from './guestbookEntryRows'
import { fromNullableIsoText, toIsoText } from './rowMapping'

/**
 * `guestbook_entries`, joined to `guestbook_voices` where a message is a voice (spec 25).
 *
 * **Every statement names `event_id`.** An entry id arrives in a URL, so a `WHERE id = ?` here
 * would be a route by which a guest at one event removes a message at another.
 *
 * **Every read leaves out `taken_down_at IS NOT NULL`**, as `SqlitePhotoRepository` does, so no
 * surface that reads through the port can serve a message the operator took down without reading.
 * The two counts a ceiling is judged on are deliberate exceptions: `countByGuest` includes them
 * (so a taken-down message does not free its author's place) and `countTakenDownBy` is about
 * nothing else.
 *
 * **A voice whose processing failed holds no place** (`HOLDS_A_PLACE`): the two counts and the
 * lists leave it out, so three failures of a file the transcoder refuses do not close the door on
 * the guest. `findById` and `listByGuest` keep it, because that is where it is removed and told.
 */

/** What `admit` writes: the columns of `guestbook_entries` alone, a voice has its own door. */
const INSERT_COLUMNS = `id, event_id, guest_id, body, status, review_kind, reviewed_at,
                 reviewed_by_user_id, created_at, taken_down_at`

export class SqliteGuestbookRepository implements GuestbookRepository {
  constructor(private readonly db: Db) {}

  async findById(eventId: EventId, entryId: GuestbookEntryId): Promise<GuestbookEntry | null> {
    const row = this.db
      .prepare<[string, string], EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM ${ENTRY_FROM}
          WHERE e.event_id = ? AND e.id = ? AND e.taken_down_at IS NULL`,
      )
      .get(eventId, entryId)
    return row === undefined ? null : toEntry(row)
  }

  async admit(entry: GuestbookEntry): Promise<GuestbookAdmission> {
    const props = entry.toProps()
    const text = props.text
    // A voice has its own door (admitVoice), which reserves its bytes too.
    if (text === null) {
      throw new Error('admit takes a written message; a voice goes through admitVoice')
    }
    const sinceIso = toIsoText(new Date(props.createdAt.getTime() - DUPLICATE_WINDOW_MS))

    // A voice whose caption equals these words is not "the same message": only written ones match.
    const findDuplicate = this.db.prepare<[string, string, string, string], EntryRow>(
      `SELECT ${ENTRY_COLUMNS} FROM ${ENTRY_FROM}
        WHERE e.event_id = ? AND e.guest_id = ? AND e.body = ? AND e.created_at > ?
          AND e.taken_down_at IS NULL AND v.entry_id IS NULL
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT 1`,
    )
    const countHeld = this.db.prepare<[string, string], { readonly n: number }>(
      `SELECT COUNT(*) AS n FROM ${ENTRY_FROM}
        WHERE e.event_id = ? AND e.guest_id = ? AND ${HOLDS_A_PLACE}`,
    )
    const countOpen = this.db.prepare<[string], { readonly n: number }>(
      `SELECT COUNT(*) AS n FROM ${ENTRY_FROM}
        WHERE e.event_id = ? AND e.status <> 'rejected' AND e.taken_down_at IS NULL
          AND ${HOLDS_A_PLACE}`,
    )
    const insert = this.db.prepare<Record<string, string | null>>(
      `INSERT INTO guestbook_entries (${INSERT_COLUMNS})
            VALUES (@id, @event_id, @guest_id, @body, @status, @review_kind, @reviewed_at,
                    @reviewed_by_user_id, @created_at, @taken_down_at)`,
    )

    // One write transaction, taken up front (`immediate`): the counts below are the last committed
    // state and nothing can commit between them and the insert, which is what makes the ceilings
    // and the duplicate check hold when two requests overlap. better-sqlite3 is synchronous, so no
    // `await` can be written inside.
    return this.db
      .transaction((): GuestbookAdmission => {
        const duplicate = findDuplicate.get(props.eventId, props.guestId, text.value, sinceIso)
        if (duplicate !== undefined) return { kind: 'duplicate', entry: toEntry(duplicate) }

        const refusal = guestbookRefusalFor({
          heldByGuest: countHeld.get(props.eventId, props.guestId)?.n ?? 0,
          openInEvent: countOpen.get(props.eventId)?.n ?? 0,
        })
        if (refusal !== null) return { kind: 'refused', refusal }

        insert.run({
          id: props.id,
          event_id: props.eventId,
          guest_id: props.guestId,
          body: text.value,
          status: props.status,
          review_kind: props.review?.kind ?? null,
          reviewed_at: props.review === null ? null : toIsoText(props.review.at),
          reviewed_by_user_id: props.review?.kind === 'host' ? props.review.userId : null,
          created_at: toIsoText(props.createdAt),
          taken_down_at: null,
        })
        return { kind: 'added', entry }
      })
      .immediate()
  }

  async save(entry: GuestbookEntry): Promise<void> {
    const props = entry.toProps()
    this.db
      .prepare<Record<string, string | null>>(
        `UPDATE guestbook_entries
            SET status = @status, review_kind = @review_kind, reviewed_at = @reviewed_at,
                reviewed_by_user_id = @reviewed_by_user_id
          WHERE event_id = @event_id AND id = @id AND taken_down_at IS NULL`,
      )
      .run({
        id: props.id,
        event_id: props.eventId,
        status: props.status,
        review_kind: props.review?.kind ?? null,
        reviewed_at: props.review === null ? null : toIsoText(props.review.at),
        reviewed_by_user_id: props.review?.kind === 'host' ? props.review.userId : null,
      })
  }

  async listByStatuses(
    eventId: EventId,
    statuses: readonly EntryStatus[],
    limit: number,
  ): Promise<readonly GuestbookEntry[]> {
    if (statuses.length === 0) return []
    const marks = statuses.map(() => '?').join(', ')
    return this.db
      .prepare<(string | number)[], EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM ${ENTRY_FROM}
          WHERE e.event_id = ? AND e.status IN (${marks}) AND e.taken_down_at IS NULL
            AND ${HOLDS_A_PLACE}
          ORDER BY e.created_at ASC, e.id ASC
          LIMIT ?`,
      )
      .all(eventId, ...statuses, limit)
      .map(toEntry)
  }

  async listWrittenByStatuses(
    eventId: EventId,
    statuses: readonly EntryStatus[],
    limit: number,
  ): Promise<readonly WrittenGuestbookEntry[]> {
    if (statuses.length === 0) return []
    const marks = statuses.map(() => '?').join(', ')
    // Voices are left out in the query, so the LIMIT counts messages the wall can read; the
    // filter after it is the type's proof, not a second rule.
    return this.db
      .prepare<(string | number)[], EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM ${ENTRY_FROM}
          WHERE e.event_id = ? AND e.status IN (${marks}) AND e.taken_down_at IS NULL
            AND v.entry_id IS NULL
          ORDER BY e.created_at ASC, e.id ASC
          LIMIT ?`,
      )
      .all(eventId, ...statuses, limit)
      .map(toEntry)
      .filter(isWritten)
  }

  async listWrittenForBook(
    eventId: EventId,
    until: Date,
    limit: number,
  ): Promise<readonly WrittenGuestbookEntry[]> {
    return this.db
      .prepare<[string, string, number], EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM ${ENTRY_FROM}
          WHERE e.event_id = ? AND e.status = 'published' AND e.taken_down_at IS NULL
            AND v.entry_id IS NULL AND e.created_at <= ?
          ORDER BY e.created_at ASC, e.id ASC
          LIMIT ?`,
      )
      .all(eventId, toIsoText(until), limit)
      .map(toEntry)
      .filter(isWritten)
  }

  async listByGuest(
    eventId: EventId,
    guestId: GuestId,
    limit: number,
  ): Promise<readonly GuestbookEntry[]> {
    // A failed voice stays in the guest's own list: it is how they learn it could not be saved.
    return this.db
      .prepare<[string, string, number], EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM ${ENTRY_FROM}
          WHERE e.event_id = ? AND e.guest_id = ? AND e.taken_down_at IS NULL
          ORDER BY e.created_at DESC, e.id DESC
          LIMIT ?`,
      )
      .all(eventId, guestId, limit)
      .map(toEntry)
  }

  async countByGuest(eventId: EventId, guestId: GuestId): Promise<number> {
    // No taken_down_at filter, on purpose: see the class comment. A failed voice is not counted.
    return (
      this.db
        .prepare<[string, string], { readonly n: number }>(
          `SELECT COUNT(*) AS n FROM ${ENTRY_FROM}
            WHERE e.event_id = ? AND e.guest_id = ? AND ${HOLDS_A_PLACE}`,
        )
        .get(eventId, guestId)?.n ?? 0
    )
  }

  async countOpenByEvent(eventId: EventId): Promise<number> {
    return (
      this.db
        .prepare<[string], { readonly n: number }>(
          `SELECT COUNT(*) AS n FROM ${ENTRY_FROM}
            WHERE e.event_id = ? AND e.status <> 'rejected' AND e.taken_down_at IS NULL
              AND ${HOLDS_A_PLACE}`,
        )
        .get(eventId)?.n ?? 0
    )
  }

  async delete(eventId: EventId, entryId: GuestbookEntryId): Promise<void> {
    this.db
      .prepare<[string, string]>(`DELETE FROM guestbook_entries WHERE event_id = ? AND id = ?`)
      .run(eventId, entryId)
  }

  async deleteByGuest(eventId: EventId, guestId: GuestId): Promise<number> {
    return this.db
      .prepare<[string, string]>(
        `DELETE FROM guestbook_entries
          WHERE event_id = ? AND guest_id = ? AND taken_down_at IS NULL`,
      )
      .run(eventId, guestId).changes
  }

  async locate(entryId: GuestbookEntryId): Promise<GuestbookLocation | null> {
    const row = this.db
      .prepare<
        [string],
        {
          readonly event_id: string
          readonly taken_down_at: string | null
          readonly is_voice: number
        }
      >(
        `SELECT e.event_id, e.taken_down_at, v.entry_id IS NOT NULL AS is_voice
           FROM guestbook_entries e LEFT JOIN guestbook_voices v ON v.entry_id = e.id
          WHERE e.id = ?`,
      )
      .get(entryId)
    return row === undefined
      ? null
      : {
          eventId: asEventId(row.event_id),
          takenDownAt: fromNullableIsoText(row.taken_down_at),
          voice: row.is_voice === 1,
        }
  }

  async setTakenDown(eventId: EventId, entryId: GuestbookEntryId, at: Date | null): Promise<void> {
    this.db
      .prepare<[string | null, string, string]>(
        `UPDATE guestbook_entries SET taken_down_at = ? WHERE event_id = ? AND id = ?`,
      )
      .run(at === null ? null : toIsoText(at), eventId, entryId)
  }

  async countTakenDownBy(eventId: EventId, guestId: GuestId): Promise<number> {
    return (
      this.db
        .prepare<[string, string], { readonly n: number }>(
          `SELECT COUNT(*) AS n FROM guestbook_entries
            WHERE event_id = ? AND guest_id = ? AND taken_down_at IS NOT NULL`,
        )
        .get(eventId, guestId)?.n ?? 0
    )
  }
}
