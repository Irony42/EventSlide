import type { Db } from './connection'
import { fromIsoText, fromNullableIsoText, toIsoText } from './rowMapping'
import type { GuestRepository } from '../../application/ports/guestRepository'
import { DisplayName } from '../../domain/guests/displayName'
import { Guest } from '../../domain/guests/guest'
import { asEventId, asGuestId, type EventId, type GuestId } from '../../domain/shared/ids'

/**
 * `GuestRepository` over SQLite.
 *
 * The port is asynchronous and better-sqlite3 is synchronous, which is deliberate:
 * the port must be implementable by something that goes over a socket, and a use case
 * must never be written against the assumption that a read is free.
 */

interface GuestRow {
  readonly id: string
  readonly event_id: string
  readonly display_name: string | null
  readonly joined_at: string
  readonly last_seen_at: string
  readonly revoked_at: string | null
  /** Not a column — see {@link SELECT_GUEST}. */
  readonly photo_count: number
}

interface CountRow {
  readonly total: number
}

/**
 * `Guest.photoCount` is a projection, not stored state.
 *
 * There is no `guests.photo_count` column and there must not be one. Ingest writes a
 * photo row and a media file; keeping a counter on the guest as well would make an
 * upload a two-aggregate write, and better-sqlite3 transactions are synchronous — they
 * cannot contain the `await` that ingest needs between verifying the bytes and
 * inserting the row. So the two writes could not be made atomic, and a counter would
 * drift on every half-failed upload, exactly as 1.0's did. A count recomputed from
 * `photos` on every read cannot drift.
 *
 * The subquery matches `idx_photos_event_author (event_id, author_guest_id)`, and it
 * carries `event_id` as well as the guest id: rule 5 of CLAUDE.md holds for a
 * projection too, so a stray photo row filed under another event cannot inflate a
 * guest's count here.
 */
const SELECT_GUEST = `
  SELECT g.id,
         g.event_id,
         g.display_name,
         g.joined_at,
         g.last_seen_at,
         g.revoked_at,
         (SELECT COUNT(*)
            FROM photos p
           WHERE p.event_id        = g.event_id
             AND p.author_guest_id = g.id) AS photo_count
    FROM guests g
`

/**
 * `INSERT … ON CONFLICT (id) DO UPDATE`, never `INSERT OR REPLACE`.
 *
 * REPLACE deletes the conflicting row before inserting the new one, and foreign keys
 * are ON for this connection — so `photos.author_guest_id … ON DELETE CASCADE` would
 * fire and a guest renaming themselves mid-party would take their own photos off the
 * wall. An upsert on the primary key updates in place and touches nothing else.
 *
 * `photo_count` is absent on purpose: it is derived, so writing it is not possible and
 * the entity's value is discarded here.
 *
 * `event_id` is absent for a different reason: `guests.id` is unique on its own, so
 * updating it would let a save carrying the wrong event re-file another event's guest
 * — overwriting that guest's name and presence, and detaching their photos from the
 * count derived above. A guest belongs to one event for life; the `WHERE` keeps the
 * write off the row instead of moving it, and `save` turns the resulting no-op into a
 * loud failure rather than a silent one.
 */
const UPSERT_GUEST = `
  INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET display_name = excluded.display_name,
                                 joined_at    = excluded.joined_at,
                                 last_seen_at = excluded.last_seen_at,
                                 revoked_at   = excluded.revoked_at
                           WHERE guests.event_id = excluded.event_id
`

/**
 * The host's "who is in the room right now", polled while the party runs, so it must
 * be served from `idx_guests_event_seen (event_id, last_seen_at DESC)` rather than by
 * walking the guest list. `>=` includes the boundary instant: a window is closed at
 * its own edge, and the use case computes `since` from the injected clock.
 */
const COUNT_ACTIVE = `
  SELECT COUNT(*) AS total
    FROM guests
   WHERE event_id     = ?
     AND last_seen_at >= ?
     AND revoked_at IS NULL
`

/**
 * A name the domain refuses is a corrupt row, not a user error: `DisplayName` parsed
 * it on the way in. Failing loudly beats silently projecting a guest as anonymous, or
 * worse, putting an unnormalised name on a projector.
 */
const toDisplayName = (raw: string | null): DisplayName | null => {
  if (raw === null) return null

  const parsed = DisplayName.create(raw)
  if (!parsed.ok) {
    throw new Error(`guests.display_name holds a value the domain rejects (${parsed.error.code})`)
  }
  return parsed.value
}

const toGuest = (row: GuestRow): Guest =>
  Guest.restore({
    id: asGuestId(row.id),
    eventId: asEventId(row.event_id),
    displayName: toDisplayName(row.display_name),
    joinedAt: fromIsoText(row.joined_at),
    lastSeenAt: fromIsoText(row.last_seen_at),
    revokedAt: fromNullableIsoText(row.revoked_at),
    photoCount: row.photo_count,
  })

/**
 * `COUNT(*)` without `GROUP BY` always returns exactly one row, but the driver cannot
 * express that — `get` is typed as possibly absent. Summing the rows yields the same
 * number without a guard that no test could ever reach.
 */
const sumOf = (rows: readonly CountRow[]): number =>
  rows.reduce((total, row) => total + row.total, 0)

export class SqliteGuestRepository implements GuestRepository {
  constructor(private readonly db: Db) {}

  async findById(eventId: EventId, guestId: GuestId): Promise<Guest | null> {
    const row = this.db
      .prepare<[string, string], GuestRow>(`${SELECT_GUEST} WHERE g.event_id = ? AND g.id = ?`)
      .get(eventId, guestId)

    return row === undefined ? null : toGuest(row)
  }

  async list(eventId: EventId): Promise<readonly Guest[]> {
    // Most recently seen first, id as the tie-break. The tie-break is not cosmetic:
    // without it two moderation screens listing the same guests could disagree, which
    // is the defect class behind 1.0's per-browser slideshow index.
    const rows = this.db
      .prepare<[string], GuestRow>(
        `${SELECT_GUEST} WHERE g.event_id = ? ORDER BY g.last_seen_at DESC, g.id`,
      )
      .all(eventId)

    return rows.map(toGuest)
  }

  async countActive(eventId: EventId, since: Date): Promise<number> {
    return sumOf(
      this.db.prepare<[string, string], CountRow>(COUNT_ACTIVE).all(eventId, toIsoText(since)),
    )
  }

  async save(guest: Guest): Promise<void> {
    const props = guest.toProps()

    const written = this.db
      .prepare<[string, string, string | null, string, string, string | null]>(UPSERT_GUEST)
      .run(
        props.id,
        props.eventId,
        props.displayName === null ? null : props.displayName.value,
        toIsoText(props.joinedAt),
        toIsoText(props.lastSeenAt),
        props.revokedAt === null ? null : toIsoText(props.revokedAt),
      )

    // The `WHERE` above skipped the update, so this id is held by a guest at another
    // event. Nothing was written — and a caller told the save succeeded would go on to
    // grant that guest upload rights here.
    if (written.changes === 0) {
      throw new Error(`guests.id ${props.id} is already held by a guest of another event`)
    }
  }

  async delete(eventId: EventId, guestId: GuestId): Promise<void> {
    // Scoped by event like every read: a guest id learned at one party must not delete
    // a row at another. Deleting nothing is success — the port is idempotent.
    this.db
      .prepare<[string, string]>(`DELETE FROM guests WHERE event_id = ? AND id = ?`)
      .run(eventId, guestId)
  }
}
