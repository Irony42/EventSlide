import type { ContentHash } from '../../domain/photos/contentHash'
import type { EventId } from '../../domain/shared/ids'

/**
 * The rendition names live in `src/domain/photos/mediaVariant.ts` and are re-exported
 * here, because which renditions exist is product policy rather than a storage detail —
 * and because a `Photo` has to be able to say which of them address its own bytes, which
 * it cannot do against a type declared in an outer layer. Every existing import of
 * `MEDIA_VARIANTS` and `MediaVariant` from this module still resolves.
 */
export {
  ALL_MEDIA_VARIANTS,
  CLIP_VARIANTS,
  MEDIA_VARIANTS,
  SERVED_VARIANTS,
  STAGED_SOURCE,
  VARIANTS_BY_KIND,
  hasVariant,
  isServedVariant,
} from '../../domain/photos/mediaVariant'
export type {
  ClipVariant,
  MediaVariant,
  PhotoVariant,
  ServedVariant,
} from '../../domain/photos/mediaVariant'

import type { MediaVariant } from '../../domain/photos/mediaVariant'

/**
 * Where the bytes live.
 *
 * Three renditions per photo, because one size cannot serve a 4K projector and a
 * moderation grid on a laptop:
 *
 * | Variant | Longest edge | Used by |
 * | --- | --- | --- |
 * | `display` | 2560 px | the wall and the guest's own view |
 * | `thumb` | 480 px | the moderation grid, the mosaic layout, the album index |
 * | `original` | untouched, EXIF-stripped | the ZIP export, so a host keeps full quality |
 *
 * Two more for a clip — `video`, the transcoded H.264/AAC file, and `poster`, the still
 * frame everything that cannot play a video renders instead — plus `source`, the guest's
 * upload while it waits for the transcoder. `source` is inside the store rather than in a
 * scratch directory so the event's purge, the reconciliation figure and the container's
 * one writable volume all reach it; it is outside `SERVED_VARIANTS` so that nothing can
 * hand it back to a caller.
 *
 * Addressing is `(eventId, contentHash, variant)` and nothing else. The store never
 * sees a guest-supplied filename, so a filename can no longer be a path — 1.0 built
 * its path from the original name and depended on a regex to keep `..` out of it.
 *
 * The `eventId` in the address is what makes "delete this event's media" a single
 * bounded operation and what keeps two events' files from ever sharing a name.
 */

/**
 * A byte range, as a `Range` request asks for it. Inclusive at both ends, which is what
 * HTTP means and what `createReadStream` takes.
 *
 * It is on this port rather than solved in the HTTP layer because answering a range by
 * reading the whole object and slicing it would defeat the point: a projector seeking
 * through a clip must not make the box read the entire file per seek.
 */
export interface ByteRange {
  readonly start: number
  readonly end: number
}

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
   *
   * With a `range`, only those bytes. A `<video>` element issues `Range` requests before
   * it will let anyone scrub, and Safari will not begin playback at all against a handler
   * that answers 200 with the whole body — so this is not an optimisation, it is whether
   * a clip plays. A range outside the object answers `null`, exactly as a missing object
   * does; the caller has already read `stat` and turns that into a 416.
   */
  openRead(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
    range?: ByteRange,
  ): Promise<AsyncIterable<Uint8Array> | null>

  /** Read the whole object. Only for small variants — the thumb in a test. */
  read(eventId: EventId, hash: ContentHash, variant: MediaVariant): Promise<Uint8Array | null>

  /**
   * Idempotent. Removes every rendition stored under one digest — including the ones a
   * row of that kind does not have, so a caller never has to know which those are.
   *
   * A clip owns two digests (`Photo.storageHashes`), so removing one costs two calls.
   */
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
