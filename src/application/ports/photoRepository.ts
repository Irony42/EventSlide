import type { Photo, PhotoReview } from '../../domain/photos/photo'
import type { PhotoStatus } from '../../domain/photos/photoStatus'
import type { ContentHash } from '../../domain/photos/contentHash'
import type { EventId, GuestId, PhotoId } from '../../domain/shared/ids'

/**
 * Every method takes `eventId` first.
 *
 * That is not a style choice. Tenant isolation in this product *is* "was the event id
 * part of the query", so the port makes the unsafe call impossible to write rather than
 * merely discouraged. There is deliberately no `findById(photoId)`.
 */

export interface PhotoQuery {
  readonly statuses?: readonly PhotoStatus[]
  readonly authoredBy?: GuestId
  readonly limit?: number
  /** Opaque cursor from a previous page. Encoding is the adapter's business. */
  readonly cursor?: string
}

export interface PhotoPage {
  readonly items: readonly Photo[]
  readonly nextCursor: string | null
}

export interface PhotoStatusCounts {
  readonly pending: number
  readonly published: number
  readonly rejected: number
  readonly hidden: number
}

/**
 * The limits a batch insert must respect, checked against the rows already committed.
 *
 * They are passed in rather than read from the database because they belong to the
 * `Event` aggregate, and a repository does not get to interpret another aggregate. What
 * the repository contributes is the one thing a use case cannot: taking the count and
 * the sum **inside the same transaction as the insert**, where nothing can interleave.
 */
export interface PhotoAdmissionLimits {
  /** `events.quota_bytes`. The event's total `byteSize` may not pass it. */
  readonly quotaBytes: number
  /** `settings.maxPhotosPerGuest`; `null` is no cap. Never applies to a host author. */
  readonly maxPhotosPerGuest: number | null
}

/**
 * Why a staged photo was not inserted, with the numbers observed at the moment of the
 * decision — so the caller reports the state that actually refused it rather than the
 * stale one it read before rendering.
 */
export type PhotoRefusal =
  /** `remaining` is what the event's quota still had room for, in bytes. */
  | { readonly reason: 'quotaExceeded'; readonly remaining: number }
  /** `already` is how many photos the author held when the cap refused this one. */
  | { readonly reason: 'photoLimitReached'; readonly already: number }

/** One verdict per submitted photo, in the order submitted. */
export interface PhotoAdmission {
  readonly photoId: PhotoId
  /** `null` when the row was inserted. */
  readonly refusal: PhotoRefusal | null
}

export interface PhotoRepository {
  findById(eventId: EventId, photoId: PhotoId): Promise<Photo | null>

  /**
   * The idempotency check. A unique index on `(event_id, content_hash)` makes a
   * double-tapped submit or a retry after a dropped connection a no-op instead of a
   * duplicate slide.
   */
  findByContentHash(eventId: EventId, hash: ContentHash): Promise<Photo | null>

  /** Newest first, with ties broken by id so two clients agree on the order. */
  list(eventId: EventId, query?: PhotoQuery): Promise<PhotoPage>

  /**
   * Ordered ids only, for the wall. The playlist needs a stable list of hundreds of
   * ids, not hundreds of hydrated aggregates.
   */
  listIdsByStatus(eventId: EventId, status: PhotoStatus, limit: number): Promise<readonly PhotoId[]>

  countsByStatus(eventId: EventId): Promise<PhotoStatusCounts>

  /** Drives the event byte quota. */
  totalBytes(eventId: EventId): Promise<number>

  countByAuthor(eventId: EventId, guestId: GuestId): Promise<number>

  save(photo: Photo): Promise<void>

  /**
   * Inserts the photos of one upload that the event still has room for, and reports the
   * ones it does not — the whole thing in a single transaction.
   *
   * This is the only bulk insert, and it is the only place the byte quota and the
   * per-guest cap are actually enforced. An unconditional `saveMany` used to sit here
   * beside it, and the quota was decided before the batch was rendered: two guests
   * uploading at the same moment both read the same usage, both passed, and the quota
   * was beatable by a factor equal to the number of requests in flight. Counting inside
   * the write transaction is what closes that, so there is deliberately no way to insert
   * an upload without the check.
   *
   * Partial by design, in the order given: a photo that does not fit is reported, and
   * the ones after it are still considered. That matches how a batch already behaves
   * everywhere else in ingest — five photos and one refusal, not one opaque failure.
   *
   * Insert only. A photo id that already exists raises, because ingest mints a fresh id
   * per file and a collision there is a bug, not an update. 1.0 fired one insert per
   * file through `Promise.all` with no transaction, so a failure part-way left some rows
   * committed and some not; anything that raises here leaves the batch entirely unwritten.
   */
  saveManyWithinLimits(
    eventId: EventId,
    photos: readonly Photo[],
    limits: PhotoAdmissionLimits,
  ): Promise<readonly PhotoAdmission[]>

  /** Idempotent: deleting an already-deleted photo is not an error. */
  delete(eventId: EventId, photoId: PhotoId): Promise<void>

  /**
   * Bulk moderation. Returns the ids actually changed, so the use case can announce
   * exactly those and the console can undo exactly those.
   */
  updateStatuses(
    eventId: EventId,
    photoIds: readonly PhotoId[],
    status: PhotoStatus,
    review: PhotoReview,
  ): Promise<readonly PhotoId[]>

  /**
   * Streams the album for the ZIP export, one row at a time. Materialising a
   * four-thousand-photo album into an array before writing the archive is how a
   * self-hosted box runs out of memory.
   */
  streamForExport(eventId: EventId, statuses: readonly PhotoStatus[]): AsyncIterable<Photo>
}
