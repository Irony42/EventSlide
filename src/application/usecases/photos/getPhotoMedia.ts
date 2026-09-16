import type { ContentHash } from '../../../domain/photos/contentHash'
import type { Photo } from '../../../domain/photos/photo'
import { isVisibleOnWall } from '../../../domain/photos/photoStatus'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId, PhotoId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ByteRange, MediaStore, ServedVariant } from '../../ports/mediaStore'
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
  /**
   * A `ServedVariant`, never a `MediaVariant`: the staged source of a clip is outside
   * that union, so there is no value a route could parse that would hand a stranger a
   * guest's un-stripped upload with its location metadata still in it. The type is the
   * control.
   */
  readonly variant: ServedVariant
  readonly viewer: MediaViewer
  /**
   * The bytes a `Range` request asked for, if it did.
   *
   * Answered here rather than by slicing in the HTTP layer, because a projector seeking
   * through a clip must not make the box read the whole file per seek.
   */
  readonly range?: ByteRange
}

export interface PhotoMedia {
  readonly photoId: PhotoId
  /** The ETag: the name changes when the bytes do, which is what makes the cache safe. */
  readonly contentHash: ContentHash
  readonly variant: ServedVariant
  /** The size of the whole object, whatever range was asked for. */
  readonly byteSize: number
  readonly contentType: string
  readonly bytes: AsyncIterable<Uint8Array>
  /**
   * The range actually served, or `null` for the whole object. The HTTP layer turns it
   * into a `206` and a `Content-Range`.
   */
  readonly range: ByteRange | null
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
const mayRead = (photo: Photo, variant: ServedVariant, viewer: MediaViewer): boolean => {
  if (viewer.kind === 'moderator') return true
  if (variant === 'original') return false
  if (isVisibleOnWall(photo.status)) return true
  return viewer.kind === 'guest' && photo.isAuthoredBy({ kind: 'guest', guestId: viewer.guestId })
}

export const makeGetPhotoMedia = ({ photos, media }: GetPhotoMediaDeps): GetPhotoMedia => {
  return async ({ eventId, photoId, variant, viewer, range }) => {
    // No event lookup: this runs once per tile in a moderation grid and once per slide
    // on the wall, and the row is already reached through `(eventId, photoId)` — the
    // event is in the query, which is what scoping means here.
    const photo = await photos.findById(eventId, photoId)
    if (photo === null) return err(DomainError.notFound('photo.notFound'))

    // A rendition this row does not have misses on the **row**, not on the disk.
    // Answering `photo.mediaMissing` would use the code that means "a row points at
    // bytes that are gone" — a genuine corruption worth an operator's attention — for
    // the ordinary case of a client asking a clip for a `display`.
    if (!photo.hasVariant(variant)) return err(DomainError.notFound('photo.notFound'))

    if (!mayRead(photo, variant, viewer)) return err(DomainError.notFound('photo.notFound'))

    // The poster of a clip is a different file with its own digest; every rendition of a
    // photograph shares one. A lookup on the entity rather than a branch here.
    const hash = photo.hashFor(variant)

    // A row whose file is gone is distinguishable in the logs from a scoping miss, and
    // identical on the wire. It is the shape 1.0 produced by inserting before writing.
    const metadata = await media.stat(eventId, hash, variant)
    if (metadata === null) return err(DomainError.notFound('photo.mediaMissing'))

    // `range` is an optional *parameter* rather than an optional property, so an absent
    // one and an explicit `undefined` mean the same thing to the port — no conditional,
    // and one fewer branch that would have to be covered twice to prove nothing.
    const bytes = await media.openRead(eventId, hash, variant, range)
    if (bytes === null) {
      // Two conditions, one answer, and they are genuinely different: the object is gone,
      // or the range falls outside it. The HTTP layer already knows the object's size
      // from `stat`, so it is the one that can tell a client which — as a 416 rather than
      // a 404 — and it does not need this to repeat it.
      return err(
        DomainError.notFound(range === undefined ? 'photo.mediaMissing' : 'photo.rangeNotSatisfiable'),
      )
    }

    return ok({
      photoId: photo.id,
      contentHash: hash,
      variant,
      byteSize: metadata.byteSize,
      contentType: metadata.contentType,
      bytes,
      range: range ?? null,
    })
  }
}
