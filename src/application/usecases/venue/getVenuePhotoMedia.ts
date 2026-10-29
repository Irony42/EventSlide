import type { Event } from '../../../domain/events/event'
import type { ContentHash } from '../../../domain/photos/contentHash'
import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import { VENUE_GROUND, type ByteRange, type MediaStore } from '../../ports/mediaStore'
import type { MediaViewer } from '../photos/getPhotoMedia'

/**
 * Resolve an event's venue photograph to a stream the HTTP layer can pipe.
 *
 * Served through the application like every other byte of media, and readable by whoever may
 * already see the event's wall: the projector and a guest while it serves, and a moderator at
 * any time. A host sets the look of a draft before it is open, and the settings page has to
 * be able to show them the photograph they just uploaded.
 *
 * **The URL names a digest, and the event's settings must name the same one.** That is what
 * makes a removed or replaced photograph unreadable the moment the row changes, rather than
 * for as long as a file happens to survive; and it is the tenant boundary, because the lookup
 * is `(event, digest)` and the digest is compared with *this* event's settings. Another
 * event's digest, or a made-up one, is the same answer as no photograph.
 *
 * Every refusal is `venuePhoto.notFound`, never `forbidden`, for `getPhotoMedia`'s reason: a
 * 403 would confirm that an event holds a photograph to somebody who may not see it.
 */

export interface GetVenuePhotoMediaInput {
  readonly event: Event
  /** Parsed by the boundary. Untrusted until it is compared with the event's own. */
  readonly hash: ContentHash
  readonly viewer: MediaViewer
}

export interface VenuePhotoMedia {
  /** The ETag: the name changes when the bytes do. */
  readonly contentHash: ContentHash
  readonly byteSize: number
  readonly contentType: string
  /** The bytes, opened only if they are going to be sent. Call it at most once. */
  readonly open: (range?: ByteRange) => Promise<AsyncIterable<Uint8Array> | null>
}

export interface GetVenuePhotoMediaDeps {
  readonly media: MediaStore
}

export type GetVenuePhotoMedia = (
  input: GetVenuePhotoMediaInput,
) => Promise<Result<VenuePhotoMedia, DomainError>>

export const makeGetVenuePhotoMedia =
  ({ media }: GetVenuePhotoMediaDeps): GetVenuePhotoMedia =>
  async ({ event, hash, viewer }) => {
    const notFound = (): Result<VenuePhotoMedia, DomainError> =>
      err(DomainError.notFound('venuePhoto.notFound'))

    // A draft or an archived event serves no wall, so it serves nobody but its moderators.
    if (viewer.kind !== 'moderator' && !event.servesWall()) return notFound()

    const named = event.settings.venuePhoto
    if (named === null || !named.equals(hash)) return notFound()

    const metadata = await media.stat(event.id, hash, VENUE_GROUND)
    if (metadata === null) return notFound()

    return ok({
      contentHash: hash,
      byteSize: metadata.byteSize,
      contentType: metadata.contentType,
      open: (range?: ByteRange) => media.openRead(event.id, hash, VENUE_GROUND, range),
    })
  }
