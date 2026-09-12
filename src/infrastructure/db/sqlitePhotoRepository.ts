import type {
  PhotoAdmission,
  PhotoAdmissionLimits,
  PhotoPage,
  PhotoQuery,
  PhotoRepository,
  PhotoStatusCounts,
} from '../../application/ports/photoRepository'
import { allowsAnotherPhoto, fitsInQuota, remainingQuota } from '../../domain/events/quota'
import { ClipDuration } from '../../domain/clips/clipDuration'
import { Caption } from '../../domain/photos/caption'
import { ContentHash } from '../../domain/photos/contentHash'
import { Dimensions } from '../../domain/photos/dimensions'
import type { MediaKind } from '../../domain/photos/mediaKind'
import {
  Photo,
  STILL,
  type PhotoAuthor,
  type PhotoFacet,
  type PhotoReview,
} from '../../domain/photos/photo'
import { canTransition, type PhotoStatus } from '../../domain/photos/photoStatus'
import type { DomainError } from '../../domain/shared/errors'
import {
  asEventId,
  asGuestId,
  asPhotoId,
  asUserId,
  type EventId,
  type GuestId,
  type PhotoId,
} from '../../domain/shared/ids'
import type { Result } from '../../domain/shared/result'
import type { Db } from './connection'
import { fromIsoText, fromNullableIsoText, toIsoText } from './rowMapping'

/**
 * `PhotoRepository` over SQLite.
 *
 * Three properties of this adapter are load-bearing, and each of them is a 1.0 defect
 * paid for once already:
 *
 * 1. **Every statement filters on `event_id`.** Tenant isolation in this product *is*
 *    "was the event id part of the query". There is no statement here that can be run
 *    without one.
 * 2. **A multi-file upload is one transaction, and the quota is counted inside it.**
 *    1.0 fired one insert per file through `Promise.all`, so a duplicate in the fifth
 *    file left four rows committed and the guest with no way to tell which of their
 *    photos landed. 2.0 then read the byte total *before* the batch was rendered, which
 *    made the quota beatable by two guests uploading at the same moment; the sum and the
 *    inserts now sit in the same transaction.
 * 3. **Paging is keyset, never `OFFSET`.** Guests keep uploading while a host scrolls
 *    the queue, and an offset shifts under them — which shows one photo twice and
 *    skips another entirely.
 */

/** Selected everywhere a whole photo is hydrated, so one mapper covers every read. */
const PHOTO_COLUMNS = `
  id, event_id, author_guest_id, author_user_id, status, content_hash,
  width, height, byte_size, caption, created_at,
  review_kind, reviewed_at, reviewed_by_user_id,
  media_kind, duration_ms, poster_hash
`

const INSERT_PHOTO = `
  INSERT INTO photos (
    id, event_id, author_guest_id, author_user_id, status, content_hash,
    width, height, byte_size, caption, created_at,
    review_kind, reviewed_at, reviewed_by_user_id,
    media_kind, duration_ms, poster_hash
  ) VALUES (
    @id, @event_id, @author_guest_id, @author_user_id, @status, @content_hash,
    @width, @height, @byte_size, @caption, @created_at,
    @review_kind, @reviewed_at, @reviewed_by_user_id,
    @media_kind, @duration_ms, @poster_hash
  )
`

/**
 * The two totals the event's limits are judged against. Declared beside the insert
 * because `saveManyWithinLimits` runs all three in one transaction, and it is that
 * pairing — not the queries themselves — that enforces the quota.
 *
 * **The sum spans two tables, and it has to.** A clip's upload is staged on the disk the
 * quota exists to protect from the moment it is accepted, and it has no `photos` row
 * until the transcode succeeds — so counting `photos` alone would under-report an event
 * by the whole contents of the queue, for the whole time the queue is draining, and
 * `MediaStore.usedBytes` would disagree with the database by exactly that amount. The
 * media store's contract says that difference means a leak worth logging, so it must not
 * be produced routinely by a feature working correctly.
 *
 * The overlap is in the conservative direction and lasts one transaction: a clip's output
 * row is inserted while its job is still `running`, so for that instant the event is
 * charged for both the source and the result. It refuses at the very edge of a full quota
 * rather than over-filling a disk, which is the direction to err in.
 */
const SUM_EVENT_BYTES = `
  SELECT (SELECT COALESCE(SUM(byte_size), 0) FROM photos WHERE event_id = :eventId)
       + (SELECT COALESCE(SUM(source_byte_size), 0)
            FROM clip_jobs
           WHERE event_id = :eventId AND status IN ('queued', 'running')) AS value
`

const COUNT_BY_AUTHOR = `
  SELECT COUNT(*) AS value FROM photos WHERE event_id = ? AND author_guest_id = ?
`

/**
 * Scoped by `event_id` as well as by `id`: a save is not a licence to reach into
 * another event's row.
 */
const UPDATE_PHOTO = `
  UPDATE photos
     SET author_guest_id     = @author_guest_id,
         author_user_id      = @author_user_id,
         status              = @status,
         content_hash        = @content_hash,
         width               = @width,
         height              = @height,
         byte_size           = @byte_size,
         caption             = @caption,
         created_at          = @created_at,
         review_kind         = @review_kind,
         reviewed_at         = @reviewed_at,
         reviewed_by_user_id = @reviewed_by_user_id,
         media_kind          = @media_kind,
         duration_ms         = @duration_ms,
         poster_hash         = @poster_hash
   WHERE id = @id AND event_id = @event_id
`

interface PhotoRow {
  readonly id: string
  readonly event_id: string
  readonly author_guest_id: string | null
  readonly author_user_id: string | null
  /** Narrowed by the `CHECK` constraint on the column, so the mapper trusts it. */
  readonly status: PhotoStatus
  readonly content_hash: string
  readonly width: number
  readonly height: number
  readonly byte_size: number
  readonly caption: string | null
  readonly created_at: string
  readonly review_kind: 'host' | 'automatic' | null
  readonly reviewed_at: string | null
  readonly reviewed_by_user_id: string | null
  /** Narrowed by the `CHECK` on the column; the mapper still refuses anything else. */
  readonly media_kind: string
  readonly duration_ms: number | null
  readonly poster_hash: string | null
}

/** Named parameters, so one object binds both the insert and the update. */
interface PhotoBindings {
  readonly id: string
  readonly event_id: string
  readonly author_guest_id: string | null
  readonly author_user_id: string | null
  readonly status: string
  readonly content_hash: string
  readonly width: number
  readonly height: number
  readonly byte_size: number
  readonly caption: string | null
  readonly created_at: string
  readonly review_kind: string | null
  readonly reviewed_at: string | null
  readonly reviewed_by_user_id: string | null
  readonly media_kind: MediaKind
  readonly duration_ms: number | null
  readonly poster_hash: string | null
}

const EMPTY_PAGE: PhotoPage = { items: [], nextCursor: null }

const ZERO_COUNTS: PhotoStatusCounts = { pending: 0, published: 0, rejected: 0, hidden: 0 }

/**
 * A row that contradicts a `CHECK` constraint can only come from a hand-edited
 * database or a migration bug. `Photo.restore` trusts its input, so the mapper is
 * where that trust is verified — loudly, naming the row, rather than inventing an
 * author for a slide that is about to be projected.
 */
const corruptRow = (photoId: string, problem: string): Error =>
  new Error(`photos row ${photoId} ${problem}: the database does not match the schema`)

const trusted = <T>(result: Result<T, DomainError>, photoId: string, column: string): T => {
  if (!result.ok) throw corruptRow(photoId, `has an invalid ${column} (${result.error.code})`)
  return result.value
}

/** `author_guest_id` XOR `author_user_id`, as `photos_one_author` enforces. */
const toAuthor = (row: PhotoRow): PhotoAuthor => {
  if (row.author_guest_id !== null) {
    return { kind: 'guest', guestId: asGuestId(row.author_guest_id) }
  }
  if (row.author_user_id !== null) return { kind: 'host', userId: asUserId(row.author_user_id) }
  throw corruptRow(row.id, 'has neither an author guest nor an author user')
}

const authorColumns = (
  author: PhotoAuthor,
): { readonly guestId: string | null; readonly userId: string | null } =>
  author.kind === 'guest'
    ? { guestId: author.guestId, userId: null }
    : { guestId: null, userId: author.userId }

/**
 * `automatic` keeps `reviewed_by_user_id` null on purpose: "nobody decided this" must
 * stay distinguishable from "the host decided this" when someone asks afterwards how a
 * photo reached the wall.
 */
const toReview = (row: PhotoRow): PhotoReview | null => {
  if (row.review_kind === null) return null

  const at = fromNullableIsoText(row.reviewed_at)
  if (at === null) throw corruptRow(row.id, 'records a review kind but no reviewed_at')
  if (row.review_kind === 'automatic') return { kind: 'automatic', at }

  if (row.reviewed_by_user_id === null) {
    throw corruptRow(row.id, 'records a host review but no reviewed_by_user_id')
  }
  return { kind: 'host', userId: asUserId(row.reviewed_by_user_id), at }
}

const reviewColumns = (
  review: PhotoReview | null,
): {
  readonly kind: string | null
  readonly at: string | null
  readonly userId: string | null
} => {
  if (review === null) return { kind: null, at: null, userId: null }
  if (review.kind === 'host') {
    return { kind: 'host', at: toIsoText(review.at), userId: review.userId }
  }
  return { kind: 'automatic', at: toIsoText(review.at), userId: null }
}

/**
 * The clip facet, or the absence of one.
 *
 * A row that carries one half of a clip and not the other is a corrupt database — the
 * coherence rule cannot be a `CHECK` on this table, because SQLite's `ADD COLUMN` cannot
 * add one and rebuilding `photos` would copy every album that has ever run this schema
 * (migration 003 says so). So it is refused here, loudly, naming the row. The failure
 * mode this replaces is a clip reaching the projector with no duration, which the wall
 * would render as a slide that never advances.
 */
const toFacet = (row: PhotoRow): PhotoFacet => {
  if (row.media_kind === 'photo') {
    if (row.duration_ms !== null || row.poster_hash !== null) {
      throw corruptRow(row.id, 'is a photograph carrying a clip duration or poster')
    }
    return STILL
  }
  if (row.media_kind !== 'clip') {
    throw corruptRow(row.id, `has an unknown media_kind (${row.media_kind})`)
  }
  if (row.duration_ms === null || row.poster_hash === null) {
    throw corruptRow(row.id, 'is a clip with no duration or no poster')
  }
  return {
    kind: 'clip',
    // The cap is deployment configuration and this row was admitted under whatever it
    // was at the time, so the stored value is its own ceiling: re-validating against
    // today's `MAX_CLIP_SECONDS` would make lowering the setting corrupt an existing
    // album rather than apply to the next upload.
    duration: trusted(ClipDuration.create(row.duration_ms, row.duration_ms), row.id, 'duration_ms'),
    posterHash: trusted(ContentHash.create(row.poster_hash), row.id, 'poster_hash'),
  }
}

const facetColumns = (
  facet: PhotoFacet,
): {
  readonly kind: MediaKind
  readonly durationMs: number | null
  readonly posterHash: string | null
} =>
  facet.kind === 'clip'
    ? { kind: 'clip', durationMs: facet.duration.ms, posterHash: facet.posterHash.value }
    : { kind: 'photo', durationMs: null, posterHash: null }

const toBindings = (photo: Photo): PhotoBindings => {
  const props = photo.toProps()
  const author = authorColumns(props.author)
  const review = reviewColumns(props.review)
  const facet = facetColumns(props.facet)

  return {
    id: props.id,
    event_id: props.eventId,
    author_guest_id: author.guestId,
    author_user_id: author.userId,
    status: props.status,
    content_hash: props.contentHash.value,
    width: props.dimensions.width,
    height: props.dimensions.height,
    byte_size: props.byteSize,
    caption: props.caption === null ? null : props.caption.value,
    created_at: toIsoText(props.createdAt),
    review_kind: review.kind,
    reviewed_at: review.at,
    reviewed_by_user_id: review.userId,
    media_kind: facet.kind,
    duration_ms: facet.durationMs,
    poster_hash: facet.posterHash,
  }
}

const toPhoto = (row: PhotoRow): Photo =>
  Photo.restore({
    id: asPhotoId(row.id),
    eventId: asEventId(row.event_id),
    author: toAuthor(row),
    status: row.status,
    contentHash: trusted(ContentHash.create(row.content_hash), row.id, 'content_hash'),
    dimensions: trusted(Dimensions.create(row.width, row.height), row.id, 'width or height'),
    byteSize: row.byte_size,
    caption: row.caption === null ? null : trusted(Caption.create(row.caption), row.id, 'caption'),
    createdAt: fromIsoText(row.created_at),
    review: toReview(row),
    facet: toFacet(row),
  })

/**
 * The keyset position: the sort key of the last row of a page.
 *
 * Encoded rather than exposed as two query parameters so a caller cannot mistake it for
 * a page number to increment. Base64url is not a secret — anyone can decode it — which
 * is why `decodeCursor` validates the shape instead of trusting it.
 */
interface Cursor {
  readonly createdAt: string
  readonly id: string
}

const encodeCursor = (row: PhotoRow): string =>
  Buffer.from(JSON.stringify([row.created_at, row.id]), 'utf8').toString('base64url')

const decodeCursor = (raw: string): Cursor => {
  // Restarting from page one on an unreadable cursor would show a guest an album that
  // repeats itself forever instead of surfacing the paging bug.
  const rejected = new Error(`PhotoRepository.list received a cursor it did not issue: ${raw}`)

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    throw rejected
  }

  if (!Array.isArray(parsed) || parsed.length !== 2) throw rejected
  const [createdAt, id] = parsed
  if (typeof createdAt !== 'string' || typeof id !== 'string') throw rejected
  return { createdAt, id }
}

const requirePositiveLimit = (limit: number, method: string): void => {
  // `LIMIT 0` answers with an empty page and no cursor, which a caller reads as "the
  // album ended".
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`PhotoRepository.${method} requires a positive integer limit, got ${limit}`)
  }
}

const placeholders = (count: number): string => new Array(count).fill('?').join(', ')

interface AggregateRow {
  readonly value: number | null
}

/**
 * `SUM` over an event that has received nothing yet is `NULL`, which is zero bytes
 * rather than a missing answer. One helper for both counters so that conversion lives
 * in a single tested place instead of being spelled `COALESCE` in one query and `?? 0`
 * in the next.
 */
const aggregate = (row: AggregateRow | undefined): number => row?.value ?? 0

export class SqlitePhotoRepository implements PhotoRepository {
  constructor(private readonly db: Db) {}

  async findById(eventId: EventId, photoId: PhotoId): Promise<Photo | null> {
    const row = this.db
      .prepare<[string, string], PhotoRow>(
        `SELECT ${PHOTO_COLUMNS} FROM photos WHERE event_id = ? AND id = ?`,
      )
      .get(eventId, photoId)

    return row === undefined ? null : toPhoto(row)
  }

  async findByContentHash(eventId: EventId, hash: ContentHash): Promise<Photo | null> {
    const row = this.db
      .prepare<[string, string], PhotoRow>(
        `SELECT ${PHOTO_COLUMNS} FROM photos WHERE event_id = ? AND content_hash = ?`,
      )
      .get(eventId, hash.value)

    return row === undefined ? null : toPhoto(row)
  }

  /**
   * One page of the album, newest first, ties broken by ascending id.
   *
   * The total order matters beyond tidiness: without the id tie-break two moderators'
   * screens can disagree about what comes next, which is 1.0's per-browser slideshow
   * index in a new costume.
   */
  async list(eventId: EventId, query: PhotoQuery = {}): Promise<PhotoPage> {
    const limit = query.limit
    if (limit !== undefined) requirePositiveLimit(limit, 'list')
    const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor)

    // An explicitly empty status filter matches nothing. `status IN ()` is not valid
    // SQL, and answering with every photo would put a pending one on the wall.
    if (query.statuses !== undefined && query.statuses.length === 0) return EMPTY_PAGE

    const filters = ['event_id = ?']
    const params: (string | number)[] = [eventId]

    if (query.statuses !== undefined) {
      filters.push(`status IN (${placeholders(query.statuses.length)})`)
      params.push(...query.statuses)
    }
    if (query.authoredBy !== undefined) {
      filters.push('author_guest_id = ?')
      params.push(query.authoredBy)
    }
    if (cursor !== null) {
      // The keyset predicate, matching `ORDER BY created_at DESC, id ASC`. An OFFSET
      // here would skip or repeat a photo every time a guest uploads mid-scroll.
      filters.push('(created_at < ? OR (created_at = ? AND id > ?))')
      params.push(cursor.createdAt, cursor.createdAt, cursor.id)
    }

    // One row more than asked for: that is what says whether another page exists,
    // without a second scan of the same index to count.
    if (limit !== undefined) params.push(limit + 1)

    const rows = this.db
      .prepare<(string | number)[], PhotoRow>(
        `SELECT ${PHOTO_COLUMNS}
           FROM photos
          WHERE ${filters.join(' AND ')}
          ORDER BY created_at DESC, id ASC${limit === undefined ? '' : ' LIMIT ?'}`,
      )
      .all(...params)

    const exhausted = limit === undefined || rows.length <= limit
    const page = exhausted ? rows : rows.slice(0, limit)
    const last = exhausted ? undefined : page.at(-1)
    return {
      items: page.map(toPhoto),
      nextCursor: last === undefined ? null : encodeCursor(last),
    }
  }

  async listIdsByStatus(
    eventId: EventId,
    status: PhotoStatus,
    limit: number,
  ): Promise<readonly PhotoId[]> {
    requirePositiveLimit(limit, 'listIdsByStatus')

    return this.db
      .prepare<[string, string, number], { readonly id: string }>(
        `SELECT id
           FROM photos
          WHERE event_id = ? AND status = ?
          ORDER BY created_at DESC, id ASC
          LIMIT ?`,
      )
      .all(eventId, status, limit)
      .map((row) => asPhotoId(row.id))
  }

  async countsByStatus(eventId: EventId): Promise<PhotoStatusCounts> {
    const counts: Record<PhotoStatus, number> = { ...ZERO_COUNTS }

    for (const row of this.db
      .prepare<[string], { readonly status: PhotoStatus; readonly count: number }>(
        `SELECT status, COUNT(*) AS count FROM photos WHERE event_id = ? GROUP BY status`,
      )
      .all(eventId)) {
      counts[row.status] = row.count
    }
    return counts
  }

  /**
   * Drives the event byte quota, so it counts every status: a rejected photo still
   * occupies the disk it was written to.
   */
  async totalBytes(eventId: EventId): Promise<number> {
    return aggregate(
      this.db.prepare<{ readonly eventId: string }, AggregateRow>(SUM_EVENT_BYTES).get({ eventId }),
    )
  }

  async countByAuthor(eventId: EventId, guestId: GuestId): Promise<number> {
    return aggregate(
      this.db.prepare<[string, string], AggregateRow>(COUNT_BY_AUTHOR).get(eventId, guestId),
    )
  }

  /**
   * Update-or-insert one photo: the moderation decision and the caption paths.
   *
   * A photo already stored under this id is updated rather than replaced: SQLite's
   * `INSERT OR REPLACE` deletes the conflicting row first, and `reactions.photo_id`
   * cascades from `photos` — so a re-saved photo would silently lose every reaction
   * the room had given it. A duplicate `(event_id, content_hash)` still raises, which
   * is what makes a double-tapped submit one slide instead of two.
   *
   * The two statements are one transaction because they are one decision: without it a
   * concurrent insert between the miss and the insert turns an update into a raise.
   */
  async save(photo: Photo): Promise<void> {
    const update = this.db.prepare<PhotoBindings>(UPDATE_PHOTO)
    const insert = this.db.prepare<PhotoBindings>(INSERT_PHOTO)
    const bindings = toBindings(photo)

    this.db.transaction(() => {
      if (update.run(bindings).changes === 0) insert.run(bindings)
    })()
  }

  /**
   * The upload batch: count, sum, decide and insert, all inside one write transaction.
   *
   * This is the fix for a real race. The quota used to be decided by the use case from
   * a `SUM` taken before the batch was even rendered, and `await`s sat between that read
   * and the insert — so two guests uploading at the same moment both read the same
   * usage, both passed, and the quota was beatable by a factor equal to the number of
   * requests in flight. The same held for the per-guest cap.
   *
   * What makes the check exact is that better-sqlite3 is **synchronous**: no `await` can
   * be written between the `SUM` below and the `INSERT`s that follow it, so no other
   * request can run in between. `.immediate()` extends that across connections — it
   * takes the write lock before the first read, so the totals are the last committed
   * state and no other writer can commit between the check and the insert. A deferred
   * transaction would open on a read snapshot and raise `SQLITE_BUSY_SNAPSHOT` when it
   * tried to upgrade: still correct, but delivered as a failed upload rather than as an
   * enforced quota.
   *
   * No counter column, deliberately. `used_bytes` on `events` would make this a single
   * conditional `UPDATE`, but it is derived state: `photos` rows also disappear through
   * `ON DELETE CASCADE` from `guests` and `events`, which no repository method observes,
   * so the counter would drift from the rows it summarises and nothing would say so.
   * The sum is the truth; the transaction is what makes reading it safe.
   */
  async saveManyWithinLimits(
    eventId: EventId,
    photos: readonly Photo[],
    limits: PhotoAdmissionLimits,
  ): Promise<readonly PhotoAdmission[]> {
    const insert = this.db.prepare<PhotoBindings>(INSERT_PHOTO)
    const sumBytes = this.db.prepare<{ readonly eventId: string }, AggregateRow>(SUM_EVENT_BYTES)
    const countAuthored = this.db.prepare<[string, string], AggregateRow>(COUNT_BY_AUTHOR)

    return this.db
      .transaction((): readonly PhotoAdmission[] => {
        let usedBytes = aggregate(sumBytes.get({ eventId }))
        /** One `COUNT` per author, then kept in step with what this batch inserts. */
        const authored = new Map<string, number>()
        const alreadyBy = (guestId: GuestId): number => {
          const known = authored.get(guestId)
          if (known !== undefined) return known

          const counted = aggregate(countAuthored.get(eventId, guestId))
          authored.set(guestId, counted)
          return counted
        }

        const verdicts: PhotoAdmission[] = []
        for (const photo of photos) {
          const author = photo.author
          const guestId = author.kind === 'guest' ? author.guestId : null

          if (guestId !== null) {
            const already = alreadyBy(guestId)
            if (!allowsAnotherPhoto(limits.maxPhotosPerGuest, already)) {
              verdicts.push({
                photoId: photo.id,
                refusal: { reason: 'photoLimitReached', already },
              })
              continue
            }
          }

          if (!fitsInQuota(limits.quotaBytes, usedBytes, photo.byteSize)) {
            verdicts.push({
              photoId: photo.id,
              refusal: {
                reason: 'quotaExceeded',
                remaining: remainingQuota(limits.quotaBytes, usedBytes),
              },
            })
            continue
          }

          insert.run(toBindings(photo))
          usedBytes += photo.byteSize
          if (guestId !== null) authored.set(guestId, alreadyBy(guestId) + 1)
          verdicts.push({ photoId: photo.id, refusal: null })
        }
        return verdicts
      })
      .immediate()
  }

  async delete(eventId: EventId, photoId: PhotoId): Promise<void> {
    this.db
      .prepare<[string, string]>(`DELETE FROM photos WHERE event_id = ? AND id = ?`)
      .run(eventId, photoId)
  }

  /**
   * Bulk moderation, in one transaction, returning only the ids that actually moved.
   *
   * The transition table is consulted directly rather than through `Photo`: a bulk
   * publish over a two-hundred-photo selection reads one column per row instead of
   * hydrating two hundred aggregates, and `canTransition` is the same single source of
   * truth the entity uses.
   *
   * A photo already in the target status is skipped rather than re-stamped, so the use
   * case announces exactly what changed and the console's undo covers exactly that. An
   * id under another event finds no row, which is what makes cross-tenant moderation
   * impossible here.
   */
  async updateStatuses(
    eventId: EventId,
    photoIds: readonly PhotoId[],
    status: PhotoStatus,
    review: PhotoReview,
  ): Promise<readonly PhotoId[]> {
    const decision = reviewColumns(review)
    const current = this.db.prepare<[string, string], { readonly status: PhotoStatus }>(
      `SELECT status FROM photos WHERE event_id = ? AND id = ?`,
    )
    const move = this.db.prepare<
      [string, string | null, string | null, string | null, string, string]
    >(
      `UPDATE photos
          SET status = ?, review_kind = ?, reviewed_at = ?, reviewed_by_user_id = ?
        WHERE event_id = ? AND id = ?`,
    )

    const changed: PhotoId[] = []
    this.db.transaction(() => {
      for (const photoId of photoIds) {
        const row = current.get(eventId, photoId)
        if (row === undefined || row.status === status) continue
        if (!canTransition(row.status, status)) continue

        move.run(status, decision.kind, decision.at, decision.userId, eventId, photoId)
        changed.push(photoId)
      }
    })()

    return changed
  }

  /**
   * Streams the album for the ZIP export one row at a time.
   *
   * `.iterate()`, never `.all()`: a four-thousand-photo wedding materialised into an
   * array before the archive is written is how a self-hosted box runs out of memory
   * during the one operation a host runs after the party.
   */
  async *streamForExport(eventId: EventId, statuses: readonly PhotoStatus[]): AsyncIterable<Photo> {
    if (statuses.length === 0) return

    const rows = this.db
      .prepare<string[], PhotoRow>(
        `SELECT ${PHOTO_COLUMNS}
           FROM photos
          WHERE event_id = ? AND status IN (${placeholders(statuses.length)})
          ORDER BY created_at DESC, id ASC`,
      )
      .iterate(eventId, ...statuses)

    for (const row of rows) yield toPhoto(row)
  }
}
