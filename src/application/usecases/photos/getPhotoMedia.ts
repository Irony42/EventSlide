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
}

export interface PhotoMedia {
  readonly photoId: PhotoId
  /** The ETag: the name changes when the bytes do, which is what makes the cache safe. */
  readonly contentHash: ContentHash
  readonly variant: ServedVariant
  /** The size of the whole object. What a `Range` header is judged against. */
  readonly byteSize: number
  readonly contentType: string
  /**
   * The bytes, opened only if they are going to be sent. **Call it at most once.**
   *
   * A function rather than a stream, and this is a fix rather than a style: every answer
   * of this use case used to carry an open stream, and three of the HTTP layer's four
   * answers do not send one. A `416`, a `304` and the first of a range request's two
   * calls all threw their stream away, and `fsMediaStore.openRead` opens the file
   * descriptor when the stream is *constructed*, not when it is read — so a `<video>`
   * seeking through a clip, or a projector revalidating a slide it already holds, leaked
   * one descriptor per request until the process hit `EMFILE` and the wall went dark.
   *
   * Deciding first and opening second makes that unrepresentable: the caller knows the
   * status, the validator and the range before anything is opened, and the one stream it
   * opens is the one it writes. It also collapses a range request from two calls to one,
   * so the authorization above is decided once per request rather than twice.
   *
   * `null` means the object is gone, or the range falls outside it — the caller has the
   * size from `byteSize` and has already told those two apart.
   *
   * @param range inclusive at both ends, as `Range` is. Absent means the whole object.
   */
  readonly open: (range?: ByteRange) => Promise<AsyncIterable<Uint8Array> | null>
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
  return async ({ eventId, photoId, variant, viewer }) => {
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

    return ok({
      photoId: photo.id,
      contentHash: hash,
      variant,
      byteSize: metadata.byteSize,
      contentType: metadata.contentType,
      // Authorization is decided above, once, and captured here: by the time this runs
      // the caller has committed to sending these bytes. `range` is an optional
      // *parameter* rather than an optional property, so an absent one and an explicit
      // `undefined` mean the same thing to the port.
      open: (range?: ByteRange) => media.openRead(eventId, hash, variant, range),
    })
  }
}
