import { GuestbookEntry } from '../../domain/guestbook/guestbookEntry'
import { DUPLICATE_WINDOW_MS, guestbookRefusalFor } from '../../domain/guestbook/guestbookLimits'
import { GuestbookText } from '../../domain/guestbook/guestbookText'
import { isPhotoStatus } from '../../domain/photos/photoStatus'
import {
  asEventId,
  asGuestId,
  asGuestbookEntryId,
  asUserId,
  type EventId,
  type GuestId,
  type GuestbookEntryId,
} from '../../domain/shared/ids'
import type {
  GuestbookAdmission,
  GuestbookRepository,
} from '../../application/ports/guestbookRepository'
import type { Db } from './connection'
import { fromIsoText, fromNullableIsoText, toIsoText } from './rowMapping'

/**
 * `guestbook_entries`.
 *
 * **Every statement names `event_id`.** An entry id arrives in a URL, so a `WHERE id = ?` here
 * would be a route by which a guest at one event removes a message at another.
 *
 * **Every read leaves out `taken_down_at IS NOT NULL`**, as `SqlitePhotoRepository` does, so no
 * surface that reads through the port can serve a message the operator took down without reading.
 * The two counts a ceiling is judged on are deliberate exceptions: `countByGuest` includes them
 * (so a taken-down message does not free its author's place) and `countTakenDownBy` is about
 * nothing else.
 */

const COLUMNS = `id, event_id, guest_id, body, status, review_kind, reviewed_at,
                 reviewed_by_user_id, created_at, taken_down_at`

interface EntryRow {
  readonly id: string
  readonly event_id: string
  readonly guest_id: string
  readonly body: string
  readonly status: string
  readonly review_kind: string | null
  readonly reviewed_at: string | null
  readonly reviewed_by_user_id: string | null
  readonly created_at: string
  readonly taken_down_at: string | null
}

const corruptRow = (id: string, what: string): Error =>
  new Error(`guestbook_entries row ${id} ${what}; the database is corrupt`)

const toEntry = (row: EntryRow): GuestbookEntry => {
  const text = GuestbookText.create(row.body)
  // A stored body the domain now refuses is a corrupt row rather than a guest error: the
  // alternative is a screen rendering whatever the column holds.
  if (!text.ok) throw corruptRow(row.id, `has a body the domain refuses (${text.error.code})`)
  if (!isPhotoStatus(row.status)) throw corruptRow(row.id, `has an unknown status (${row.status})`)

  const reviewedAt = fromNullableIsoText(row.reviewed_at)
  let review: GuestbookEntry['review'] = null
  if (row.review_kind === 'host' && reviewedAt !== null && row.reviewed_by_user_id !== null) {
    review = { kind: 'host', userId: asUserId(row.reviewed_by_user_id), at: reviewedAt }
  } else if (row.review_kind === 'automatic' && reviewedAt !== null) {
    review = { kind: 'automatic', at: reviewedAt }
  }

  return GuestbookEntry.restore({
    id: asGuestbookEntryId(row.id),
    eventId: asEventId(row.event_id),
    guestId: asGuestId(row.guest_id),
    text: text.value,
    status: row.status,
    review,
    createdAt: fromIsoText(row.created_at),
    takenDownAt: fromNullableIsoText(row.taken_down_at),
  })
}

export class SqliteGuestbookRepository implements GuestbookRepository {
  constructor(private readonly db: Db) {}

  async findById(eventId: EventId, entryId: GuestbookEntryId): Promise<GuestbookEntry | null> {
    const row = this.db
      .prepare<[string, string], EntryRow>(
        `SELECT ${COLUMNS} FROM guestbook_entries
          WHERE event_id = ? AND id = ? AND taken_down_at IS NULL`,
      )
      .get(eventId, entryId)
    return row === undefined ? null : toEntry(row)
  }

  async admit(entry: GuestbookEntry): Promise<GuestbookAdmission> {
    const props = entry.toProps()
    const sinceIso = toIsoText(new Date(props.createdAt.getTime() - DUPLICATE_WINDOW_MS))

    const findDuplicate = this.db.prepare<[string, string, string, string], EntryRow>(
      `SELECT ${COLUMNS} FROM guestbook_entries
        WHERE event_id = ? AND guest_id = ? AND body = ? AND created_at > ?
          AND taken_down_at IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
    )
    const countHeld = this.db.prepare<[string, string], { readonly n: number }>(
      `SELECT COUNT(*) AS n FROM guestbook_entries WHERE event_id = ? AND guest_id = ?`,
    )
    const countOpen = this.db.prepare<[string], { readonly n: number }>(
      `SELECT COUNT(*) AS n FROM guestbook_entries
        WHERE event_id = ? AND status <> 'rejected' AND taken_down_at IS NULL`,
    )
    const insert = this.db.prepare<Record<string, string | null>>(
      `INSERT INTO guestbook_entries (${COLUMNS})
            VALUES (@id, @event_id, @guest_id, @body, @status, @review_kind, @reviewed_at,
                    @reviewed_by_user_id, @created_at, @taken_down_at)`,
    )

    // One write transaction, taken up front (`immediate`): the counts below are the last committed
    // state and nothing can commit between them and the insert, which is what makes the ceilings
    // and the duplicate check hold when two requests overlap. better-sqlite3 is synchronous, so no
    // `await` can be written inside.
    return this.db
      .transaction((): GuestbookAdmission => {
        const duplicate = findDuplicate.get(props.eventId, props.guestId, props.text.value, sinceIso)
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
          body: props.text.value,
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

  async listByGuest(
    eventId: EventId,
    guestId: GuestId,
    limit: number,
  ): Promise<readonly GuestbookEntry[]> {
    return this.db
      .prepare<[string, string, number], EntryRow>(
        `SELECT ${COLUMNS} FROM guestbook_entries
          WHERE event_id = ? AND guest_id = ? AND taken_down_at IS NULL
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
      )
      .all(eventId, guestId, limit)
      .map(toEntry)
  }

  async countByGuest(eventId: EventId, guestId: GuestId): Promise<number> {
    // No `taken_down_at` filter, on purpose: see the class comment.
    return (
      this.db
        .prepare<[string, string], { readonly n: number }>(
          `SELECT COUNT(*) AS n FROM guestbook_entries WHERE event_id = ? AND guest_id = ?`,
        )
        .get(eventId, guestId)?.n ?? 0
    )
  }

  async countOpenByEvent(eventId: EventId): Promise<number> {
    return (
      this.db
        .prepare<[string], { readonly n: number }>(
          `SELECT COUNT(*) AS n FROM guestbook_entries
            WHERE event_id = ? AND status <> 'rejected' AND taken_down_at IS NULL`,
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
