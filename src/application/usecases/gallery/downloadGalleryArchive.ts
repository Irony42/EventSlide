import type { Event } from '../../../domain/events/event'
import type { ContentHash } from '../../../domain/photos/contentHash'
import type { ServedVariant } from '../../../domain/photos/mediaVariant'
import type { Photo } from '../../../domain/photos/photo'
import type { DomainError } from '../../../domain/shared/errors'
import type { ShareLinkId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ArchiveWriter } from '../../ports/archiveWriter'
import type { Logger } from '../../ports/logger'
import type { MediaStore } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'
import { albumEntries } from '../shared/albumEntries'
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
 * nothing materialised, and the same `albumEntries` — and differs from `exportAlbum` in the
 * three ways a public surface has to:
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
 * - **The album is read in pages**, not as a row stream. See `albumEntries`.
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

    /**
     * One entry's bytes — opened, and the link re-read, only when the writer pulls them.
     *
     * **Lazy, and that is the revocation guarantee rather than a tidy-up.** The real
     * writer (`archiverWriter`) used to queue entries as fast as it was handed them and
     * write them one by one afterwards, so a check made while *listing* the entries ran for
     * the whole album before the first byte left the box: measured, a link revoked after
     * the first chunk of a 200-photograph archive still delivered all 52 MB. Here the check
     * runs at the moment an entry's bytes are consumed, so a revoke stops the download at
     * the next photograph.
     *
     * It also means one file descriptor is open at a time, not one per entry. That is true
     * of the pair, not of this function alone: the descriptor is opened here, when the
     * entry's bytes are first asked for, and the writer asks for them one entry at a time,
     * only once it has written the previous one, and closes what it was handed when the
     * client goes away. `archiverWriter.test.ts` and `galleryArchive.test.ts` count the
     * sources and the real files, so a writer that went back to taking the album at once
     * would turn this sentence false in a red test rather than in a production incident.
     *
     * Bytes that vanish between being found and being read — a retention purge running
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
     * What the entries are made of, and what a row with no stored download is: skipped, as the
     * host's export skips it. One orphaned row must not abort a download whose headers are
     * long gone. The pages, the names and what each kind is archived as are `albumEntries`.
     */
    const open = async (
      _photo: Photo,
      hash: ContentHash,
      variant: ServedVariant,
    ): Promise<AsyncIterable<Uint8Array> | null> =>
      (await deps.media.stat(eventId, hash, variant)) === null ? null : bytesOf(hash, variant)

    const entries = albumEntries({
      photos: deps.photos,
      eventId,
      slug: event.slug.value,
      statuses: GALLERY_STATUSES,
      open,
      skipped: (photo) => {
        deps.logger.warn('gallery archive skipped a photo with no stored download', {
          eventId,
          photoId: photo.id,
        })
      },
    })

    return ok({ event, chunks: deps.archive.stream(entries) })
  }
