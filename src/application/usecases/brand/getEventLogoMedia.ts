import type { Event } from '../../../domain/events/event'
import type { ContentHash } from '../../../domain/photos/contentHash'
import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import { EVENT_LOGO, type ByteRange, type MediaStore } from '../../ports/mediaStore'
import type { MediaViewer } from '../photos/getPhotoMedia'

/**
 * Resolve an event's logo to a stream the HTTP layer can pipe.
 *
 * Served through the application like every other byte of media, and readable by whoever may
 * already see the event's wall: the projector and a guest while it serves, and a moderator at
 * any time. A host sets the look of a draft before it is open, and the settings page has to
 * be able to show them the logo they just uploaded.
 *
 * **The URL names a digest, and the event's settings must name the same one.** That is what
 * makes a removed or replaced logo unreadable the moment the row changes, rather than
 * for as long as a file happens to survive; and it is the tenant boundary, because the lookup
 * is `(event, digest)` and the digest is compared with *this* event's settings. Another
 * event's digest, or a made-up one, is the same answer as no logo.
 *
 * Every refusal is `logo.notFound`, never `forbidden`, for `getPhotoMedia`'s reason: a
 * 403 would confirm that an event holds a logo to somebody who may not see it.
 */

export interface GetEventLogoMediaInput {
  readonly event: Event
  /** Parsed by the boundary. Untrusted until it is compared with the event's own. */
  readonly hash: ContentHash
  readonly viewer: MediaViewer
}

export interface EventLogoMedia {
  /** The ETag: the name changes when the bytes do. */
  readonly contentHash: ContentHash
  readonly byteSize: number
  readonly contentType: string
  /** The bytes, opened only if they are going to be sent. Call it at most once. */
  readonly open: (range?: ByteRange) => Promise<AsyncIterable<Uint8Array> | null>
}

export interface GetEventLogoMediaDeps {
  readonly media: MediaStore
}

export type GetEventLogoMedia = (
  input: GetEventLogoMediaInput,
) => Promise<Result<EventLogoMedia, DomainError>>

export const makeGetEventLogoMedia =
  ({ media }: GetEventLogoMediaDeps): GetEventLogoMedia =>
  async ({ event, hash, viewer }) => {
    const notFound = (): Result<EventLogoMedia, DomainError> =>
      err(DomainError.notFound('logo.notFound'))

    // A draft or an archived event serves no wall, so it serves nobody but its moderators.
    if (viewer.kind !== 'moderator' && !event.servesWall()) return notFound()

    const named = event.settings.logo
    if (named === null || !named.equals(hash)) return notFound()

    const metadata = await media.stat(event.id, hash, EVENT_LOGO)
    if (metadata === null) return notFound()

    return ok({
      contentHash: hash,
      byteSize: metadata.byteSize,
      contentType: metadata.contentType,
      open: (range?: ByteRange) => media.openRead(event.id, hash, EVENT_LOGO, range),
    })
  }
