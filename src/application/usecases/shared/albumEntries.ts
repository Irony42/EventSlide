import { DOWNLOAD_EXTENSION, GALLERY_RENDITIONS } from '../../../domain/gallery/galleryMedia'
import type { ContentHash } from '../../../domain/photos/contentHash'
import type { ServedVariant } from '../../../domain/photos/mediaVariant'
import type { Photo } from '../../../domain/photos/photo'
import type { PhotoStatus } from '../../../domain/photos/photoStatus'
import type { EventId } from '../../../domain/shared/ids'
import type { ArchiveEntry } from '../../ports/archiveWriter'
import type { PhotoPage, PhotoQuery, PhotoRepository } from '../../ports/photoRepository'

/**
 * The entries of an album archive, for the host's own export and for the shared gallery's.
 *
 * It exists once because the two had the same loop line for line, and the copies had already
 * drifted: the host's asked the store for the variant `original` of **every** row, a clip has
 * no such rendition (`mediaVariant.ts`), and so the host's ZIP silently left out every video
 * of the event while the gallery's — which asked the domain's table — carried them. A host who
 * exported and then purged lost the clips. What a row is archived as is decided here, from the
 * same table the gallery serves its downloads from: a photograph's stored `original` as a
 * `.jpg`, a clip's transcode as an `.mp4`.
 *
 * What differs is passed in, and is all there is to differ on:
 *
 * - `statuses`: the album's rule for the host, the wall's for a stranger;
 * - `open`: how a row's bytes are asked for, and whether a missing file is a skip or an abort.
 *   The host's asks the store and takes `null` for "not there"; the gallery's re-reads the
 *   link when the bytes are pulled, so that revoking it stops a download already streaming.
 *
 * **Pages rather than a row stream, because of what a row stream holds open.** A row stream
 * keeps one better-sqlite3 statement iterating across every `await` below it, and while a
 * statement is iterating the connection refuses every write. The archive asks for an entry
 * only when it is ready to write it (see `archiverWriter`), so the same statement would stay
 * open for as long as the download lasts: measured, an upload to any other event failed for
 * the whole of a host's slow download, and 600 of 602 uploads failed during one gallery archive
 * — a public route, where anybody holding a link can start four at once. Each page here is one
 * statement that runs to completion before anything else happens.
 *
 * An entry is also asked for only when the writer is about to write it, so what `open` returns
 * is what is about to be read: one descriptor at a time, not one per photo.
 */

/** Rows per read while listing the album. Each is one statement, run to completion. */
const ALBUM_PAGE_SIZE = 200

export interface AlbumEntriesSource {
  readonly photos: PhotoRepository
  readonly eventId: EventId
  /** The event's canonical slug: the archive's folder, never anything a guest typed. */
  readonly slug: string
  readonly statuses: readonly PhotoStatus[]
  /** Narrows or reorders the listing (the best-of's favourites, oldest first); none for an album. */
  readonly filter?: Pick<PhotoQuery, 'highlightedOnly' | 'oldestFirst'>
  /** The bytes of one row's download, or `null` when the file is not there and the row is skipped. */
  readonly open: (
    photo: Photo,
    hash: ContentHash,
    variant: ServedVariant,
  ) => Promise<AsyncIterable<Uint8Array> | null>
  /** Told of each row skipped, so the caller says so to the operator in its own words. */
  readonly skipped: (photo: Photo) => void
}

export const albumEntries = async function* ({
  photos,
  eventId,
  slug,
  statuses,
  filter,
  open,
  skipped,
}: AlbumEntriesSource): AsyncIterable<ArchiveEntry> {
  let sequence = 0
  let cursor: string | null = null
  do {
    const page: PhotoPage = await photos.list(eventId, {
      statuses,
      ...filter,
      limit: ALBUM_PAGE_SIZE,
      ...(cursor === null ? {} : { cursor }),
    })
    for (const photo of page.items) {
      const variant = GALLERY_RENDITIONS[photo.kind].download
      const hash = photo.hashFor(variant)
      const bytes = await open(photo, hash, variant)
      if (bytes === null) {
        // Skipped rather than fatal: headers are long since sent by the time an entry is
        // read, so one orphaned row must not abort a multi-gigabyte download.
        skipped(photo)
        continue
      }

      sequence += 1
      // Server-generated throughout: a counter, the digest's first characters and a validated
      // slug. No guest-supplied filename reaches the archive, so no entry name can carry a path.
      const name = `${slug}/${String(sequence).padStart(4, '0')}-${hash.short}.${
        DOWNLOAD_EXTENSION[photo.kind]
      }`
      yield { name, bytes, modifiedAt: photo.createdAt }
    }
    cursor = page.nextCursor
  } while (cursor !== null)
}
