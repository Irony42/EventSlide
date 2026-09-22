import {
  DOWNLOAD_EXTENSION,
  isGalleryDownload,
  isGalleryVariant,
  isInSharedGallery,
} from '../../../domain/gallery/galleryMedia'
import type { ContentHash } from '../../../domain/photos/contentHash'
import type { ServedVariant } from '../../../domain/photos/mediaVariant'
import { DomainError } from '../../../domain/shared/errors'
import type { PhotoId, ShareLinkId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { MediaStore } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'
import {
  eventBehind,
  isMediaGrantSigned,
  notAvailable,
  type GalleryAccessDeps,
} from './galleryAccess'

/**
 * The bytes behind one signed gallery URL.
 *
 * ## The order of the checks is part of the control
 *
 * 1. **The signature**, before anything touches storage. A forged or altered URL — another
 *    photo id, another rendition, another link, a later expiry — costs one HMAC and is
 *    refused; nobody can use this route to ask the database which link ids exist.
 * 2. **The expiry the URL carries**, which the signature covers.
 * 3. **The link, read now.** Revoked, expired, or minted by an account that no longer owns
 *    the event, and every URL it ever issued stops working on this request rather than
 *    when its hour runs out. That is what "revoke is immediate" means.
 * 4. **The photograph, scoped by the link's event** and never by anything in the URL, and
 *    only while it is still published. A photograph the host unpublished after the page
 *    loaded is refused although its URL is correctly signed.
 * 5. **The rendition**, which must be one a gallery serves for that kind of row.
 *
 * Every refusal is `gallery.notAvailable`: a caller holding a URL learns whether it works,
 * and nothing else.
 */

export interface GetGalleryMediaInput {
  readonly linkId: ShareLinkId
  readonly photoId: PhotoId
  readonly variant: ServedVariant
  readonly expiresAtMs: number
  readonly signature: string
}

export interface GalleryMedia {
  readonly contentHash: ContentHash
  readonly variant: ServedVariant
  readonly byteSize: number
  readonly contentType: string
  /** `attachment` for the full-resolution download, `inline` for everything the page draws. */
  readonly disposition: 'attachment' | 'inline'
  /**
   * What the download is saved as, for an attachment; `null` for an inline rendition, which
   * is never saved under a name. Server-chosen, from the event's slug and the digest —
   * nothing a guest typed reaches it.
   */
  readonly fileName: string | null
  /** When the URL stops working. What a cache may keep it for, and no longer. */
  readonly expiresAt: Date
  /** Opens the bytes. Called at most once, after every decision above is made. */
  readonly open: () => Promise<AsyncIterable<Uint8Array> | null>
}

export interface GetGalleryMediaDeps extends GalleryAccessDeps {
  readonly photos: PhotoRepository
  readonly media: MediaStore
}

export type GetGalleryMedia = (
  input: GetGalleryMediaInput,
) => Promise<Result<GalleryMedia, DomainError>>

export const makeGetGalleryMedia =
  (deps: GetGalleryMediaDeps): GetGalleryMedia =>
  async ({ linkId, photoId, variant, expiresAtMs, signature }) => {
    if (!isMediaGrantSigned(deps.signer, { linkId, photoId, variant, expiresAtMs }, signature)) {
      return err(notAvailable())
    }

    const now = deps.clock.now()
    if (expiresAtMs <= now.getTime()) return err(notAvailable())

    const link = await deps.shareLinks.findById(linkId)
    if (link === null) return err(notAvailable())
    const event = await eventBehind(deps, link, now)
    if (event === null) return err(notAvailable())

    const photo = await deps.photos.findById(link.eventId, photoId)
    if (photo === null || !isInSharedGallery(photo.status)) return err(notAvailable())
    if (!isGalleryVariant(photo.kind, variant)) return err(notAvailable())

    const hash = photo.hashFor(variant)
    const metadata = await deps.media.stat(link.eventId, hash, variant)
    // A row whose bytes are gone is a corruption an operator should see in the log, so it
    // keeps the code the host's own media route uses for it. A caller cannot reach it
    // without a URL this server signed for a published photograph, so it is no oracle.
    if (metadata === null) return err(DomainError.notFound('photo.mediaMissing'))

    const download = isGalleryDownload(photo.kind, variant)

    return ok({
      contentHash: hash,
      variant,
      byteSize: metadata.byteSize,
      contentType: metadata.contentType,
      disposition: download ? 'attachment' : 'inline',
      fileName: download
        ? `${event.slug.value}-${hash.short}.${DOWNLOAD_EXTENSION[photo.kind]}`
        : null,
      expiresAt: new Date(expiresAtMs),
      open: () => deps.media.openRead(link.eventId, hash, variant),
    })
  }
