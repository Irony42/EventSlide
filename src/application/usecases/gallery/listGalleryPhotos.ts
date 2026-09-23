import {
  GALLERY_RENDITIONS,
  grantExpiresAt,
  type GalleryRendition,
} from '../../../domain/gallery/galleryMedia'
import type { Photo } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { PhotoQuery, PhotoRepository } from '../../ports/photoRepository'
import {
  enterGallery,
  GALLERY_STATUSES,
  grantMedia,
  openCursor,
  sealCursor,
  type GalleryAccessDeps,
  type MediaGrant,
} from './galleryAccess'

/**
 * One page of a shared gallery: the published photographs, newest first, each with the
 * three signed URLs a viewer needs — the grid tile, the larger view, the download.
 *
 * **Only what the wall shows.** The status filter is the domain's (`isInSharedGallery`),
 * applied in the query, so a pending, rejected or hidden photograph never reaches a
 * grant — and a photograph unpublished after the link was sent is gone from the next
 * page, because nothing about the link snapshotted the album.
 *
 * **The grants are minted here, per request, and expire within the hour** (capped at the
 * link's own expiry). The media route re-checks the link on every byte request, so the
 * expiry is not what makes revocation immediate; it is what stops a URL lifted out of the
 * page becoming a permanent way round the password.
 */

/** Sixty tiles: three screens of a phone's grid, one request on venue-grade Wi-Fi. */
export const GALLERY_PAGE_SIZE = 60

export interface GalleryItem {
  readonly photo: Photo
  readonly preview: MediaGrant
  readonly view: MediaGrant
  readonly download: MediaGrant
}

export interface GalleryPage {
  readonly items: readonly GalleryItem[]
  /** Sealed for this link. `null` on the last page. */
  readonly nextCursor: string | null
}

export interface ListGalleryPhotosInput {
  readonly token: string
  readonly unlockProof: string | null
  readonly cursor?: string | null
}

export interface ListGalleryPhotosDeps extends GalleryAccessDeps {
  readonly photos: PhotoRepository
}

export type ListGalleryPhotos = (
  input: ListGalleryPhotosInput,
) => Promise<Result<GalleryPage, DomainError>>

export const makeListGalleryPhotos =
  (deps: ListGalleryPhotosDeps): ListGalleryPhotos =>
  async ({ token, unlockProof, cursor }) => {
    const entered = await enterGallery(deps, token, unlockProof)
    if (!entered.ok) return entered
    const { link, event, now } = entered.value

    let after: string | null = null
    if (cursor !== undefined && cursor !== null) {
      after = openCursor(deps.signer, link, cursor)
      // A cursor this link did not seal is refused before the repository sees it: the
      // repository throws on one it did not issue, which on a public route is a 500.
      if (after === null) return err(DomainError.invalid('gallery.cursorInvalid'))
    }

    const query: PhotoQuery = {
      statuses: GALLERY_STATUSES,
      limit: GALLERY_PAGE_SIZE,
      ...(after === null ? {} : { cursor: after }),
    }
    const page = await deps.photos.list(event.id, query)

    const expiresAt = grantExpiresAt(now, link)
    const grant = (photo: Photo, rendition: GalleryRendition) =>
      grantMedia(
        deps.signer,
        link.id,
        photo.id,
        GALLERY_RENDITIONS[photo.kind][rendition],
        expiresAt,
      )

    return ok({
      items: page.items.map((photo) => ({
        photo,
        preview: grant(photo, 'preview'),
        view: grant(photo, 'view'),
        download: grant(photo, 'download'),
      })),
      nextCursor: page.nextCursor === null ? null : sealCursor(deps.signer, link, page.nextCursor),
    })
  }
