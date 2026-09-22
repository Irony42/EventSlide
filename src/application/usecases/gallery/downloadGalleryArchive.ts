import type { Event } from '../../../domain/events/event'
import { DOWNLOAD_EXTENSION, GALLERY_RENDITIONS } from '../../../domain/gallery/galleryMedia'
import type { Photo } from '../../../domain/photos/photo'
import type { DomainError } from '../../../domain/shared/errors'
import type { ShareLinkId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ArchiveEntry, ArchiveWriter } from '../../ports/archiveWriter'
import type { Logger } from '../../ports/logger'
import type { MediaStore } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'
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
 * It reuses the host's own export path — `ArchiveWriter` and `streamForExport`, streamed
 * end to end with nothing materialised — and differs from `exportAlbum` in exactly the two
 * ways a public surface has to:
 *
 * - **What is in it** is the gallery's rule, not the album's: published only, so a hidden
 *   photograph the host's own ZIP keeps is not in the one a stranger downloads. Clips are
 *   in it too, as their transcodes, because the gallery shows them.
 * - **The link is re-read before every entry.** A wedding is gigabytes and minutes of
 *   streaming, and "revoke is immediate" has to hold for the download already in flight,
 *   not only for the next one. A revoked link makes the generator throw, which aborts the
 *   response — deliberately, rather than ending the archive cleanly: a ZIP that ends early
 *   but well-formed looks exactly like a complete album, and a truncated one does not.
 */

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

    const open = async (photo: Photo): Promise<Omit<ArchiveEntry, 'name'> | null> => {
      const variant = GALLERY_RENDITIONS[photo.kind].download
      const hash = photo.hashFor(variant)
      const metadata = await deps.media.stat(event.id, hash, variant)
      if (metadata === null) return null
      const bytes = await deps.media.openRead(event.id, hash, variant)
      if (bytes === null) return null
      return { bytes, byteSize: metadata.byteSize, modifiedAt: photo.createdAt }
    }

    const entries = async function* (): AsyncIterable<ArchiveEntry> {
      let sequence = 0
      for await (const photo of deps.photos.streamForExport(event.id, GALLERY_STATUSES)) {
        if (!(await stillGrants(deps, link.id, deps.clock.now())))
          throw new ShareLinkWithdrawnError()

        const opened = await open(photo)
        if (opened === null) {
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
        const name = `${event.slug.value}/${String(sequence).padStart(4, '0')}-${
          photo.hashFor(GALLERY_RENDITIONS[photo.kind].download).short
        }.${DOWNLOAD_EXTENSION[photo.kind]}`
        yield { name, ...opened }
      }
    }

    return ok({ event, chunks: deps.archive.stream(entries()) })
  }
