import type { Event } from '../../../domain/events/event'
import { DOWNLOAD_EXTENSION, GALLERY_RENDITIONS } from '../../../domain/gallery/galleryMedia'
import type { ContentHash } from '../../../domain/photos/contentHash'
import type { ServedVariant } from '../../../domain/photos/mediaVariant'
import type { DomainError } from '../../../domain/shared/errors'
import type { ShareLinkId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ArchiveEntry, ArchiveWriter } from '../../ports/archiveWriter'
import type { Logger } from '../../ports/logger'
import type { MediaStore } from '../../ports/mediaStore'
import type { PhotoPage, PhotoRepository } from '../../ports/photoRepository'
import {
  eventBehind,
  GALLERY_STATUSES,
  isArchiveGrantSigned,
  notAvailable,
  stillGrants,
  type GalleryAccessDeps,
} from './galleryAccess'

/**
 * The whole shared album as one ZIP, behind a signed URL.
 *
 * It reuses the host's own export path — `ArchiveWriter`, streamed end to end with
 * nothing materialised — and differs from `exportAlbum` in the three ways a public surface
 * has to:
 *
 * - **What is in it** is the gallery's rule, not the album's: published only, so a hidden
 *   photograph the host's own ZIP keeps is not in the one a stranger downloads. Clips are
 *   in it too, as their transcodes, because the gallery shows them.
 * - **The link is re-read before every entry's bytes are sent.** A wedding is gigabytes
 *   and minutes of streaming, and "revoke is immediate" has to hold for the download
 *   already in flight, not only for the next one. A revoked link makes the entry's bytes
 *   throw, which aborts the response — deliberately, rather than ending the archive
 *   cleanly: a ZIP that ends early but well-formed looks exactly like a complete album,
 *   and a truncated one does not. See `bytesOf` for why the check has to be there.
 * - **The album is read in pages**, not as the export's row stream. See `entries`.
 */

/** Rows per read while listing the album. Each is one statement, run to completion. */
const ARCHIVE_PAGE_SIZE = 200

export class ShareLinkWithdrawnError extends Error {
  constructor() {
    super('the share link stopped granting while its archive was streaming')
    this.name = 'ShareLinkWithdrawnError'
  }
}

export interface DownloadGalleryArchiveInput {
  readonly linkId: ShareLinkId
  readonly expiresAtMs: number
  readonly signature: string
}

export interface GalleryArchive {
  readonly event: Event
  readonly chunks: AsyncIterable<Uint8Array>
}

export interface DownloadGalleryArchiveDeps extends GalleryAccessDeps {
  readonly photos: PhotoRepository
  readonly media: MediaStore
  readonly archive: ArchiveWriter
  readonly logger: Logger
}

export type DownloadGalleryArchive = (
  input: DownloadGalleryArchiveInput,
) => Promise<Result<GalleryArchive, DomainError>>

export const makeDownloadGalleryArchive =
  (deps: DownloadGalleryArchiveDeps): DownloadGalleryArchive =>
  async ({ linkId, expiresAtMs, signature }) => {
    // The same order as a single photograph: signature, expiry, then storage.
    if (!isArchiveGrantSigned(deps.signer, { linkId, expiresAtMs }, signature)) {
      return err(notAvailable())
    }
    if (expiresAtMs <= deps.clock.now().getTime()) return err(notAvailable())

    const link = await deps.shareLinks.findById(linkId)
    if (link === null) return err(notAvailable())
    const event = await eventBehind(deps, link, deps.clock.now())
    if (event === null) return err(notAvailable())

    /**
     * One entry's bytes — opened, and the link re-read, only when the writer pulls them.
     *
     * **Lazy, and that is the revocation guarantee rather than a tidy-up.** The real
     * writer (`archiverWriter`) queues entries as fast as it is handed them and writes them
     * one by one afterwards, so a check made while *listing* the entries ran for the whole
     * album before the first byte left the box: measured, a link revoked after the first
     * chunk of a 200-photograph archive still delivered all 52 MB. Here the check runs at
     * the moment an entry's bytes are consumed, so a revoke stops the download at the next
     * photograph. It also means one file descriptor is open at a time, not one per entry.
     *
     * Bytes that vanish between being sized and being read — a retention purge running
     * under a download — abort the archive rather than leave an empty entry in it: the
     * entry's name is already written, and a zero-byte photograph in a ZIP that otherwise
     * looks complete is the failure this file refuses everywhere else.
     */
    const granted = link.id
    const eventId = event.id
    const bytesOf = async function* (
      hash: ContentHash,
      variant: ServedVariant,
    ): AsyncIterable<Uint8Array> {
      if (!(await stillGrants(deps, granted, deps.clock.now()))) throw new ShareLinkWithdrawnError()
      const stream = await deps.media.openRead(eventId, hash, variant)
      if (stream === null)
        throw new Error('a gallery download vanished while it was being archived')
      yield* stream
    }

    /**
     * Pages rather than the export's row stream, because of what the stream holds open.
     *
     * `streamForExport` keeps one better-sqlite3 statement iterating across every `await`
     * below it, and while a statement is iterating the connection refuses every write —
     * measured, 600 of 602 uploads on a *different* event failed during one archive. That
     * shape is tolerable for a host's own occasional export; on a public route anybody
     * holding a link can start four at once. Each page here is one statement that runs to
     * completion before anything else happens.
     */
    const entries = async function* (): AsyncIterable<ArchiveEntry> {
      let sequence = 0
      let cursor: string | null = null
      do {
        const page: PhotoPage = await deps.photos.list(event.id, {
          statuses: GALLERY_STATUSES,
          limit: ARCHIVE_PAGE_SIZE,
          ...(cursor === null ? {} : { cursor }),
        })
        for (const photo of page.items) {
          const variant = GALLERY_RENDITIONS[photo.kind].download
          const hash = photo.hashFor(variant)
          const metadata = await deps.media.stat(event.id, hash, variant)
          if (metadata === null) {
            // Skipped, as the host's export skips it: one orphaned row must not abort a
            // download whose headers are long gone.
            deps.logger.warn('gallery archive skipped a photo with no stored download', {
              eventId: event.id,
              photoId: photo.id,
            })
            continue
          }

          sequence += 1
          // Server-generated throughout: a counter, the digest's first characters and a
          // validated slug. Nothing a guest typed names an entry.
          const name = `${event.slug.value}/${String(sequence).padStart(4, '0')}-${hash.short}.${
            DOWNLOAD_EXTENSION[photo.kind]
          }`
          yield {
            name,
            bytes: bytesOf(hash, variant),
            byteSize: metadata.byteSize,
            modifiedAt: photo.createdAt,
          }
        }
        cursor = page.nextCursor
      } while (cursor !== null)
    }

    return ok({ event, chunks: deps.archive.stream(entries()) })
  }
