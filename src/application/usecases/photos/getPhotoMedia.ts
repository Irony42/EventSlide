import type { ContentHash } from '../../../domain/photos/contentHash'
import type { Photo } from '../../../domain/photos/photo'
import { isVisibleOnWall } from '../../../domain/photos/photoStatus'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId, PhotoId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { MediaStore, MediaVariant } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'

/**
 * Resolve one photo and one variant to a stream the HTTP layer can pipe.
 *
 * Media is served through the application rather than by `express.static`, which is the
 * only way authorization applies to every byte. 1.0 served the photo directory
 * statically, so a pending photo — one nobody had approved — was readable by anyone who
 * guessed a filename, and the file itself still carried the guest's GPS coordinates.
 *
 * Every refusal is `photo.notFound`, never `forbidden`. A 403 would confirm that a
 * photo id exists in an event the caller cannot see, which turns this endpoint into an
 * enumeration oracle for a wedding's photo count.
 */

export type MediaViewer =
  /** The projector and anyone holding the public wall URL. */
  | { readonly kind: 'public' }
  | { readonly kind: 'guest'; readonly guestId: GuestId }
  | { readonly kind: 'moderator'; readonly userId: UserId }

export interface GetPhotoMediaInput {
  readonly eventId: EventId
  readonly photoId: PhotoId
  readonly variant: MediaVariant
  readonly viewer: MediaViewer
}

export interface PhotoMedia {
  readonly photoId: PhotoId
  /** The ETag: the name changes when the bytes do, which is what makes the cache safe. */
  readonly contentHash: ContentHash
  readonly variant: MediaVariant
  readonly byteSize: number
  readonly contentType: string
  readonly bytes: AsyncIterable<Uint8Array>
}

export interface GetPhotoMediaDeps {
  readonly photos: PhotoRepository
  readonly media: MediaStore
}

export type GetPhotoMedia = (
  input: GetPhotoMediaInput,
) => Promise<Result<PhotoMedia, DomainError>>

/**
 * A moderator of this event may read anything, including the rendered original the
 * album export uses. Everyone else gets the two derived variants only, and only for a
 * photo that is either on the wall or their own — so a guest can see their photo
 * waiting for moderation without being able to see anybody else's.
 */
const mayRead = (photo: Photo, variant: MediaVariant, viewer: MediaViewer): boolean => {
  if (viewer.kind === 'moderator') return true
  if (variant === 'original') return false
  if (isVisibleOnWall(photo.status)) return true
  return viewer.kind === 'guest' && photo.isAuthoredBy({ kind: 'guest', guestId: viewer.guestId })
}

export const makeGetPhotoMedia = ({ photos, media }: GetPhotoMediaDeps): GetPhotoMedia => {
  return async ({ eventId, photoId, variant, viewer }) => {
    // No event lookup: this runs once per tile in a moderation grid and once per slide
    // on the wall, and the row is already reached through `(eventId, photoId)` — the
    // event is in the query, which is what scoping means here.
    const photo = await photos.findById(eventId, photoId)
    if (photo === null) return err(DomainError.notFound('photo.notFound'))

    if (!mayRead(photo, variant, viewer)) return err(DomainError.notFound('photo.notFound'))

    // A row whose file is gone is distinguishable in the logs from a scoping miss, and
    // identical on the wire. It is the shape 1.0 produced by inserting before writing.
    const metadata = await media.stat(eventId, photo.contentHash, variant)
    if (metadata === null) return err(DomainError.notFound('photo.mediaMissing'))

    const bytes = await media.openRead(eventId, photo.contentHash, variant)
    if (bytes === null) return err(DomainError.notFound('photo.mediaMissing'))

    return ok({
      photoId: photo.id,
      contentHash: photo.contentHash,
      variant,
      byteSize: metadata.byteSize,
      contentType: metadata.contentType,
      bytes,
    })
  }
}
