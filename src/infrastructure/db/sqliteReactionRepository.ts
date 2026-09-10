import type { Db } from './connection'
import { fromIsoText, toIsoText } from './rowMapping'
import type { ReactionRepository } from '../../application/ports/reactionRepository'
import { Reaction } from '../../domain/reactions/reaction'
import type { ReactionKind } from '../../domain/reactions/reactionKind'
import {
  emptyCounts,
  type ReactionCounts,
  type TallyEntry,
} from '../../domain/reactions/reactionTally'
import {
  asEventId,
  asGuestId,
  asPhotoId,
  asReactionId,
  type EventId,
  type GuestId,
  type PhotoId,
} from '../../domain/shared/ids'

/**
 * `ReactionRepository` over SQLite.
 *
 * Reactions are the highest-frequency write in the product — a room of two hundred
 * people tapping at a photo on the wall — so every statement here is served by one of
 * the three indexes declared on the table, and nothing recounts in JavaScript what
 * SQLite can group.
 */

interface ReactionRow {
  readonly id: string
  readonly event_id: string
  readonly photo_id: string
  readonly guest_id: string
  /**
   * Typed as the closed set rather than as `string`. `reactions.kind` carries a CHECK
   * constraint naming exactly these five values, so `Reaction.restore` trusting the
   * row is backed by the schema rather than by hope; an adapter test asserts the
   * constraint is really there, because that is what makes this annotation honest.
   */
  readonly kind: ReactionKind
  readonly created_at: string
}

interface KindTallyRow {
  readonly kind: ReactionKind
  readonly total: number
}

interface PhotoTallyRow extends KindTallyRow {
  readonly photo_id: string
}

interface GuestEntryRow {
  readonly kind: ReactionKind
  readonly guest_id: string
}

interface CountRow {
  readonly total: number
}

/**
 * A plain `INSERT`, deliberately not an upsert.
 *
 * A reaction is a fact with no lifecycle — there is no `changeKind`, so an upsert
 * would have nothing to update. Letting the write fail is what keeps
 * `idx_reactions_unique (photo_id, guest_id, kind)` the enforcement the port
 * documents: a double tap on a phone that lost signal is refused by the database, so a
 * count projected a metre tall cannot be inflated by a retry.
 */
const INSERT_REACTION = `
  INSERT INTO reactions (id, event_id, photo_id, guest_id, kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
`

const SELECT_REACTION = `
  SELECT id, event_id, photo_id, guest_id, kind, created_at
    FROM reactions
   WHERE event_id = ?
     AND photo_id = ?
     AND guest_id = ?
     AND kind     = ?
`

/**
 * The whole event tallied in **one** grouped query.
 *
 * "Photo of the night" and the end-of-event recap run over every photo of the event,
 * and the wall re-reads them as guests tap. A query per photo would be an N+1 on the
 * hottest read of the evening; grouping in SQLite returns one row per photo and kind
 * instead. Served by `idx_reactions_event_photo (event_id, photo_id)`.
 */
const TALLY_EVENT = `
  SELECT photo_id, kind, COUNT(*) AS total
    FROM reactions
   WHERE event_id = ?
   GROUP BY photo_id, kind
`

const toReaction = (row: ReactionRow): Reaction =>
  Reaction.restore({
    id: asReactionId(row.id),
    eventId: asEventId(row.event_id),
    photoId: asPhotoId(row.photo_id),
    guestId: asGuestId(row.guest_id),
    kind: row.kind,
    createdAt: fromIsoText(row.created_at),
  })

/**
 * `emptyCounts()` is the base for every tally, so a kind nobody sent comes back as `0`
 * rather than as a missing key. The phone and the projector both index these by kind;
 * a gap there renders as `NaN` on a wall in front of a family.
 */
const tallyInto = (counts: Record<ReactionKind, number>, row: KindTallyRow): void => {
  counts[row.kind] = row.total
}

/**
 * `COUNT(*)` without `GROUP BY` always returns exactly one row, but the driver cannot
 * express that — `get` is typed as possibly absent. Summing the rows yields the same
 * number without a guard that no test could ever reach.
 */
const sumOf = (rows: readonly CountRow[]): number =>
  rows.reduce((total, row) => total + row.total, 0)

export class SqliteReactionRepository implements ReactionRepository {
  constructor(private readonly db: Db) {}

  async findOne(
    eventId: EventId,
    photoId: PhotoId,
    guestId: GuestId,
    kind: ReactionKind,
  ): Promise<Reaction | null> {
    const row = this.db
      .prepare<[string, string, string, string], ReactionRow>(SELECT_REACTION)
      .get(eventId, photoId, guestId, kind)

    return row === undefined ? null : toReaction(row)
  }

  async save(reaction: Reaction): Promise<void> {
    const props = reaction.toProps()

    this.db
      .prepare<[string, string, string, string, string, string]>(INSERT_REACTION)
      .run(
        props.id,
        props.eventId,
        props.photoId,
        props.guestId,
        props.kind,
        toIsoText(props.createdAt),
      )
  }

  async delete(
    eventId: EventId,
    photoId: PhotoId,
    guestId: GuestId,
    kind: ReactionKind,
  ): Promise<void> {
    this.db
      .prepare<[string, string, string, string]>(
        `DELETE FROM reactions
               WHERE event_id = ? AND photo_id = ? AND guest_id = ? AND kind = ?`,
      )
      .run(eventId, photoId, guestId, kind)
  }

  async countsFor(eventId: EventId, photoId: PhotoId): Promise<ReactionCounts> {
    const rows = this.db
      .prepare<[string, string], KindTallyRow>(
        `SELECT kind, COUNT(*) AS total
           FROM reactions
          WHERE event_id = ? AND photo_id = ?
          GROUP BY kind`,
      )
      .all(eventId, photoId)

    const counts: Record<ReactionKind, number> = { ...emptyCounts() }
    for (const row of rows) tallyInto(counts, row)
    return counts
  }

  async countsForEvent(eventId: EventId): Promise<ReadonlyMap<PhotoId, ReactionCounts>> {
    const rows = this.db.prepare<[string], PhotoTallyRow>(TALLY_EVENT).all(eventId)

    const byPhoto = new Map<PhotoId, Record<ReactionKind, number>>()
    for (const row of rows) {
      const photoId = asPhotoId(row.photo_id)
      const counts = byPhoto.get(photoId) ?? { ...emptyCounts() }
      tallyInto(counts, row)
      byPhoto.set(photoId, counts)
    }
    // A photo nobody reacted to is absent rather than present with zeroes: the caller
    // ranks what it is given, and inventing a row per photo would defeat the grouping.
    return byPhoto
  }

  async listByGuest(eventId: EventId, guestId: GuestId): Promise<readonly TallyEntry[]> {
    const rows = this.db
      .prepare<[string, string], GuestEntryRow>(
        `SELECT kind, guest_id
           FROM reactions
          WHERE event_id = ? AND guest_id = ?
          ORDER BY created_at DESC, id`,
      )
      .all(eventId, guestId)

    return rows.map((row) => ({ kind: row.kind, guestId: asGuestId(row.guest_id) }))
  }

  async countByGuestSince(eventId: EventId, guestId: GuestId, since: Date): Promise<number> {
    // `idx_reactions_guest_recent (event_id, guest_id, created_at DESC)` exists for
    // this one query: it runs on the anti-spam path of every single tap.
    return sumOf(
      this.db
        .prepare<[string, string, string], CountRow>(
          `SELECT COUNT(*) AS total
             FROM reactions
            WHERE event_id   = ?
              AND guest_id   = ?
              AND created_at >= ?`,
        )
        .all(eventId, guestId, toIsoText(since)),
    )
  }
}
