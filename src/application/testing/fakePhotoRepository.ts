import { allowsAnotherPhoto, fitsInQuota, remainingQuota } from '../../domain/events/quota'
import type { Photo, PhotoReview } from '../../domain/photos/photo'
import type { PhotoStatus } from '../../domain/photos/photoStatus'
import type { ContentHash } from '../../domain/photos/contentHash'
import type { EventId, GuestId, PhotoId } from '../../domain/shared/ids'
import type { StagedByteSource } from '../ports/clipJobRepository'
import type {
  PhotoAdmission,
  PhotoAdmissionLimits,
  PhotoPage,
  PhotoQuery,
  PhotoRepository,
  PhotoStatusCounts,
} from '../ports/photoRepository'

/**
 * In-memory `PhotoRepository`, behaving the way the SQLite adapter must.
 *
 * Three properties are load-bearing, and each of them is a defect this codebase has
 * already paid for once:
 *
 * 1. **Rows are keyed by `${eventId}:${photoId}`.** A stub keyed by photo id alone
 *    would answer a cross-event read with the photo, and every tenant-isolation test
 *    in the suite would pass while the product leaked. The composite key makes the
 *    wrong event genuinely miss.
 * 2. **`(eventId, contentHash)` is unique**, as `idx_photos_event_hash` makes it. A
 *    save that would duplicate rejects, so the "double-tapped Envoyer" path is
 *    exercised against a repository that behaves like the real one.
 * 3. **One total order: `createdAt` descending, then id ascending.** That is
 *    `idx_photos_event_status_created`. Without the id tie-break two projectors
 *    reading the same event can disagree about what comes next, which is 1.0's
 *    per-browser slideshow index in a new costume.
 */

/** Code-unit order, not locale order: an id sort must not depend on the host's ICU. */
const compareIds = (left: string, right: string): number =>
  Number(left > right) - Number(left < right)

const newestFirst = (left: Photo, right: Photo): number =>
  right.createdAt.getTime() - left.createdAt.getTime() || compareIds(left.id, right.id)

interface Cursor {
  readonly createdAt: number
  readonly id: string
}

/**
 * `<epoch millis>:<photo id>` — opaque to the caller, and enough to resume a
 * `(createdAt DESC, id ASC)` scan without an offset. Offset paging would skip or
 * repeat a photo as guests keep uploading during a scroll.
 */
const encodeCursor = (photo: Photo): string => `${photo.createdAt.getTime()}:${photo.id}`

const decodeCursor = (raw: string): Cursor | null => {
  const separator = raw.indexOf(':')
  if (separator <= 0 || separator === raw.length - 1) return null
  const createdAt = Number(raw.slice(0, separator))
  if (!Number.isInteger(createdAt)) return null
  return { createdAt, id: raw.slice(separator + 1) }
}

const isAfterCursor = (photo: Photo, cursor: Cursor): boolean => {
  const createdAt = photo.createdAt.getTime()
  if (createdAt !== cursor.createdAt) return createdAt < cursor.createdAt
  return compareIds(photo.id, cursor.id) > 0
}

const requirePositive = (limit: number, method: string): void => {
  if (!Number.isInteger(limit) || limit < 1) {
    // A `LIMIT 0` would return an empty page with no cursor, so a paging bug would
    // read as "the album ended" instead of failing.
    throw new Error(`PhotoRepository.${method} requires a positive integer limit, got ${limit}`)
  }
}

const ZERO_COUNTS: PhotoStatusCounts = { pending: 0, published: 0, rejected: 0, hidden: 0 }

const key = (eventId: EventId, photoId: PhotoId): string => `${eventId}:${photoId}`

const findHashClash = (rows: ReadonlyMap<string, Photo>, photo: Photo): PhotoId | null => {
  for (const row of rows.values()) {
    if (row.eventId !== photo.eventId) continue
    if (row.id === photo.id) continue
    if (row.contentHash.equals(photo.contentHash)) return row.id
  }
  return null
}

const insertInto = (rows: Map<string, Photo>, photo: Photo): void => {
  const clash = findHashClash(rows, photo)
  if (clash !== null) {
    // The message mirrors better-sqlite3's, so a test asserting a rejection reads the
    // same way against either implementation.
    throw new Error(
      `UNIQUE constraint failed: photos.event_id, photos.content_hash ` +
        `(${photo.eventId}/${photo.contentHash.value} already held by ${clash})`,
    )
  }
  rows.set(key(photo.eventId, photo.id), photo)
}

export class FakePhotoRepository implements PhotoRepository {
  private readonly rows = new Map<string, Photo>()

  /**
   * Seed fixtures. Enforces the same uniqueness `save` does: a fixture that duplicates
   * a content hash inside one event is a broken fixture, and letting it through would
   * make the test that follows prove nothing.
   */
  seed(...photos: readonly Photo[]): this {
    for (const photo of photos) insertInto(this.rows, photo)
    return this
  }

  private forEvent(eventId: EventId): Photo[] {
    return [...this.rows.values()].filter((photo) => photo.eventId === eventId)
  }

  async findById(eventId: EventId, photoId: PhotoId): Promise<Photo | null> {
    return this.rows.get(key(eventId, photoId)) ?? null
  }

  async findByContentHash(eventId: EventId, hash: ContentHash): Promise<Photo | null> {
    return this.forEvent(eventId).find((photo) => photo.contentHash.equals(hash)) ?? null
  }

  async list(eventId: EventId, query: PhotoQuery = {}): Promise<PhotoPage> {
    const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor)
    if (query.cursor !== undefined && cursor === null) {
      // Silently restarting from page one would hide a paging bug behind an album that
      // simply repeats itself forever.
      throw new Error(`PhotoRepository.list received a cursor it did not issue: ${query.cursor}`)
    }
    if (query.limit !== undefined) requirePositive(query.limit, 'list')

    const matching = this.forEvent(eventId)
      .filter((photo) => query.statuses === undefined || query.statuses.includes(photo.status))
      .filter((photo) => this.matchesAuthor(photo, query.authoredBy))
      .filter((photo) => cursor === null || isAfterCursor(photo, cursor))
      .sort(newestFirst)

    if (query.limit === undefined) return { items: matching, nextCursor: null }

    const items = matching.slice(0, query.limit)
    const last = items.at(-1)
    const exhausted = items.length === matching.length
    return {
      items,
      nextCursor: last === undefined || exhausted ? null : encodeCursor(last),
    }
  }

  private matchesAuthor(photo: Photo, guestId: GuestId | undefined): boolean {
    if (guestId === undefined) return true
    return photo.author.kind === 'guest' && photo.author.guestId === guestId
  }

  async listIdsByStatus(
    eventId: EventId,
    status: PhotoStatus,
    limit: number,
  ): Promise<readonly PhotoId[]> {
    requirePositive(limit, 'listIdsByStatus')
    return this.forEvent(eventId)
      .filter((photo) => photo.status === status)
      .sort(newestFirst)
      .slice(0, limit)
      .map((photo) => photo.id)
  }

  async countsByStatus(eventId: EventId): Promise<PhotoStatusCounts> {
    const counts = { ...ZERO_COUNTS }
    for (const photo of this.forEvent(eventId)) counts[photo.status] += 1
    return counts
  }

  /**
   * Bytes this event is charged that are **not** photo rows: the transcode queue's
   * staged sources.
   *
   * The SQLite adapter reads them from `clip_jobs` inside the same statement as its
   * `SUM(byte_size)`, because the quota is "bytes on the disk for this event" and a
   * clip waiting to be transcoded is on the disk. This fake cannot reach a second table
   * on its own, so a test that is about clips wires the clip repository in here — which
   * is what keeps the two implementations answering the same number.
   *
   * A test that is only about photographs leaves it alone and charges nothing extra,
   * which is exactly what an event with no clips is charged.
   */
  private staged: StagedByteSource | null = null

  chargeStagedBytesFrom(source: StagedByteSource): this {
    this.staged = source
    return this
  }

  private async stagedBytes(eventId: EventId): Promise<number> {
    return this.staged === null ? 0 : this.staged.stagedBytes(eventId)
  }

  /**
   * The photographs' half of the total, on its own.
   *
   * What `FakeClipJobRepository.stage` asks for, and the reason it is separate: staging
   * a clip has to re-read the *queue's* half after its one `await`, so it needs the half
   * that no clip upload can change apart from the half that every clip upload changes.
   */
  async photoBytes(eventId: EventId): Promise<number> {
    return this.forEvent(eventId).reduce((total, photo) => total + photo.byteSize, 0)
  }

  async totalBytes(eventId: EventId): Promise<number> {
    return (await this.photoBytes(eventId)) + (await this.stagedBytes(eventId))
  }

  async countByAuthor(eventId: EventId, guestId: GuestId): Promise<number> {
    return this.forEvent(eventId).filter((photo) => this.matchesAuthor(photo, guestId)).length
  }

  async save(photo: Photo): Promise<void> {
    insertInto(this.rows, photo)
  }

  /**
   * The upload batch: count, sum, decide and insert, with nothing able to interleave.
   *
   * The adapter gets that from one SQLite transaction. Here it comes from the method
   * body containing no `await` at all — an `await` between the totals and the inserts is
   * exactly the defect this method exists to remove, and it was real: the use case used
   * to read the byte total before it rendered the batch, so two guests uploading at the
   * same moment both passed the same check.
   *
   * All or nothing on a rejection, as the adapter's transaction is: a duplicate content
   * hash anywhere in the batch leaves the repository untouched. Duplicates *within* the
   * batch count too, because the unique index does not care that two conflicting rows
   * arrived together. A refusal by a *limit* is not a rejection — it is a verdict, and
   * the photos that did fit are still written.
   */
  async saveManyWithinLimits(
    eventId: EventId,
    photos: readonly Photo[],
    limits: PhotoAdmissionLimits,
  ): Promise<readonly PhotoAdmission[]> {
    // **The only `await` in this method, and it is deliberately the first statement.**
    // better-sqlite3 is synchronous, so the adapter's transaction cannot interleave; the
    // fake earns the same property by having no suspension point between the snapshot
    // below and the last write. Reading the queue after the snapshot instead would hand
    // a second concurrent call a stale view of `rows`, and the quota would be beatable
    // by the number of requests in flight — which is the defect these tests exist for.
    const stagedClipBytes = await this.stagedBytes(eventId)

    const staged = new Map(this.rows)
    const forEventIn = (rows: ReadonlyMap<string, Photo>): Photo[] =>
      [...rows.values()].filter((photo) => photo.eventId === eventId)

    let usedBytes =
      forEventIn(staged).reduce((total, photo) => total + photo.byteSize, 0) + stagedClipBytes
    const authored = new Map<string, number>()
    const alreadyBy = (guestId: GuestId): number => {
      const known = authored.get(guestId)
      if (known !== undefined) return known

      const counted = forEventIn(staged).filter(
        (photo) => photo.author.kind === 'guest' && photo.author.guestId === guestId,
      ).length
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
          verdicts.push({ photoId: photo.id, refusal: { reason: 'photoLimitReached', already } })
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

      // Insert only, as the adapter's statement is: ingest mints a fresh id per file, so
      // an id already stored is a bug rather than an update, and the mapper's
      // `INSERT OR REPLACE` twin would take the photo's reactions down with it.
      if (staged.has(key(eventId, photo.id))) {
        throw new Error(`UNIQUE constraint failed: photos.id (${photo.id} is already stored)`)
      }
      insertInto(staged, photo)
      usedBytes += photo.byteSize
      if (guestId !== null) authored.set(guestId, alreadyBy(guestId) + 1)
      verdicts.push({ photoId: photo.id, refusal: null })
    }

    this.rows.clear()
    for (const [rowKey, photo] of staged) this.rows.set(rowKey, photo)
    return verdicts
  }

  async delete(eventId: EventId, photoId: PhotoId): Promise<void> {
    this.rows.delete(key(eventId, photoId))
  }

  /**
   * Returns only the photos whose status actually moved.
   *
   * A photo already in the target status is skipped rather than re-stamped, so the use
   * case announces exactly what changed and the console's undo covers exactly that. An
   * illegal transition is skipped for the same reason: a bulk publish over a mixed
   * selection is a partial success, not a failure.
   *
   * The order of the returned ids is not part of the contract — `RETURNING` follows
   * storage order, not the caller's list.
   */
  async updateStatuses(
    eventId: EventId,
    photoIds: readonly PhotoId[],
    status: PhotoStatus,
    review: PhotoReview,
  ): Promise<readonly PhotoId[]> {
    const changed: PhotoId[] = []
    for (const photoId of photoIds) {
      const photo = this.rows.get(key(eventId, photoId))
      if (photo === undefined || photo.status === status) continue

      const moved = photo.transitionTo(status, review, review.at)
      if (!moved.ok) continue

      this.rows.set(key(eventId, photoId), moved.value)
      changed.push(photoId)
    }
    return changed
  }

  /**
   * A snapshot taken when iteration starts, not a live view: the album export runs for
   * minutes on a four-thousand-photo wedding while guests keep uploading, and a
   * writer-visible iterator would decide the archive's contents by timing.
   */
  async *streamForExport(eventId: EventId, statuses: readonly PhotoStatus[]): AsyncIterable<Photo> {
    const snapshot = this.forEvent(eventId)
      .filter((photo) => statuses.includes(photo.status))
      .sort(newestFirst)
    for (const photo of snapshot) yield photo
  }
}
