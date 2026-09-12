import type { ContentHash } from '../../domain/photos/contentHash'
import type { EventId } from '../../domain/shared/ids'

/**
 * Where the image bytes live.
 *
 * Three variants per photo, because one size cannot serve a 4K projector and a
 * moderation grid on a laptop:
 *
 * | Variant | Longest edge | Used by |
 * | --- | --- | --- |
 * | `display` | 2560 px | the wall and the guest's own view |
 * | `thumb` | 480 px | the moderation grid, the mosaic layout, the album index |
 * | `original` | untouched, EXIF-stripped | the ZIP export, so a host keeps full quality |
 *
 * Addressing is `(eventId, contentHash, variant)` and nothing else. The store never
 * sees a guest-supplied filename, so a filename can no longer be a path — 1.0 built
 * its path from the original name and depended on a regex to keep `..` out of it.
 *
 * The `eventId` in the address is what makes "delete this event's media" a single
 * bounded operation and what keeps two events' files from ever sharing a name.
 */

export const MEDIA_VARIANTS = ['original', 'display', 'thumb'] as const

export type MediaVariant = (typeof MEDIA_VARIANTS)[number]

export interface MediaMetadata {
  readonly byteSize: number
  readonly contentType: string
}

export interface MediaStore {
  /**
   * Write bytes. Must be atomic from a reader's point of view: write to a temporary
   * name and rename into place, so a concurrent read never sees a half-written file.
   */
  put(eventId: EventId, hash: ContentHash, variant: MediaVariant, bytes: Uint8Array): Promise<void>

  exists(eventId: EventId, hash: ContentHash, variant: MediaVariant): Promise<boolean>

  stat(eventId: EventId, hash: ContentHash, variant: MediaVariant): Promise<MediaMetadata | null>

  /**
   * Open for streaming. Returns `null` when absent rather than throwing, so the HTTP
   * layer answers 404 without a try/catch.
   *
   * An `AsyncIterable` rather than a path or a Node stream: the HTTP layer pipes it,
   * and a future object-storage adapter can satisfy the same signature.
   */
  openRead(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
  ): Promise<AsyncIterable<Uint8Array> | null>

  /** Read the whole object. Only for small variants — the thumb in a test. */
  read(eventId: EventId, hash: ContentHash, variant: MediaVariant): Promise<Uint8Array | null>

  /** Idempotent. Removes every variant of one photo. */
  delete(eventId: EventId, hash: ContentHash): Promise<void>

  /** Purge. Idempotent, and safe to call for an event that stored nothing. */
  deleteEvent(eventId: EventId): Promise<void>

  /**
   * Bytes on disk for the event. Used to reconcile against the quota the database
   * tracks — if the two disagree, the database is authoritative and the difference is
   * a leak worth logging.
   */
  usedBytes(eventId: EventId): Promise<number>
}
