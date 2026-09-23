import type { Event } from '../../../domain/events/event'
import { grantExpiresAt } from '../../../domain/gallery/galleryMedia'
import type { ShareLink } from '../../../domain/gallery/shareLink'
import type { DomainError } from '../../../domain/shared/errors'
import { ok, type Result } from '../../../domain/shared/result'
import type { PhotoRepository } from '../../ports/photoRepository'
import {
  enterGallery,
  GALLERY_STATUSES,
  grantArchive,
  type ArchiveGrant,
  type GalleryAccessDeps,
} from './galleryAccess'

/**
 * A guest opens the link: what the album is, how big, until when, and where the whole of
 * it can be downloaded.
 *
 * Every refusal is `galleryAccess`'s — `gallery.notAvailable`, the same for every reason,
 * or `gallery.passwordRequired` for a link that has a password nobody has entered yet.
 * Nothing about the event, not even its name, is disclosed before the password: a link
 * forwarded to somebody who was not given the password tells them only that it wants one.
 */

export interface GalleryView {
  readonly event: Event
  readonly link: ShareLink
  /** What the grid will show in total: the published photographs, nothing else. */
  readonly photoCount: number
  readonly archive: ArchiveGrant
}

export interface OpenGalleryInput {
  readonly token: string
  /** The unlock cookie, when the browser sent one. */
  readonly unlockProof: string | null
}

export interface OpenGalleryDeps extends GalleryAccessDeps {
  readonly photos: PhotoRepository
}

export type OpenGallery = (input: OpenGalleryInput) => Promise<Result<GalleryView, DomainError>>

export const makeOpenGallery =
  (deps: OpenGalleryDeps): OpenGallery =>
  async ({ token, unlockProof }) => {
    const entered = await enterGallery(deps, token, unlockProof)
    if (!entered.ok) return entered
    const { link, event, now } = entered.value

    // Summed over the statuses the domain says a gallery shows, rather than read off
    // `published` by name: the count and the grid are then the same rule.
    const counts = await deps.photos.countsByStatus(event.id)
    const photoCount = GALLERY_STATUSES.reduce((total, status) => total + counts[status], 0)

    return ok({
      event,
      link,
      photoCount,
      archive: grantArchive(deps.signer, link.id, grantExpiresAt(now, link)),
    })
  }
