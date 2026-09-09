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
   * One transaction for a whole multi-file upload. 1.0 fired several inserts through
   * `Promise.all` with no transaction, so a failure part-way left the event with some
   * rows committed and some not.
   */
  saveMany(photos: readonly Photo[]): Promise<void>

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
