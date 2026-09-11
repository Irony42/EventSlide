import type { PhotoStatus } from '../../../domain/photos/photoStatus'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventRepository } from '../../ports/eventRepository'
import type { PhotoPage, PhotoQuery, PhotoRepository } from '../../ports/photoRepository'

/**
 * The moderation console's read: one event's photos, newest first, filterable by status
 * and paged by cursor.
 *
 * Two things are deliberately *not* here. The role check belongs to the authorization
 * middleware, which knows the session and resolves "moderator **of this event**"; and
 * the status filter is a caller's choice rather than a rule, because the same read
 * serves the pending queue, the published album and the rejected bin. What the use case
 * guarantees is the part a route cannot be trusted with: the query is scoped by
 * `eventId`, so no filter combination can reach another event's photos.
 *
 * Paging is by cursor, never by offset: guests keep uploading while a host scrolls, and
 * an offset would silently skip or repeat a photo as rows shift under the page.
 */

export interface ListEventPhotosInput {
  readonly eventId: EventId
  /** Absent or `null` means every status — the host's full album view. */
  readonly statuses?: readonly PhotoStatus[] | null
  readonly limit?: number | null
  /** Opaque cursor from a previous page. */
  readonly cursor?: string | null
}

export interface ListEventPhotosDeps {
  readonly events: EventRepository
  readonly photos: PhotoRepository
}

export type ListEventPhotos = (
  input: ListEventPhotosInput,
) => Promise<Result<PhotoPage, DomainError>>

export const makeListEventPhotos = ({
  events,
  photos,
}: ListEventPhotosDeps): ListEventPhotos => {
  return async ({ eventId, statuses, limit, cursor }) => {
    // An unknown event is a 404 rather than an empty page, so a host who mistypes a
    // slug is told the event is wrong instead of concluding the guests sent nothing.
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    // Built by spread rather than by assigning `undefined`: with
    // `exactOptionalPropertyTypes`, "no filter" is an absent key, not a present one
    // holding nothing.
    const query: PhotoQuery = {
      ...(statuses == null ? {} : { statuses }),
      ...(limit == null ? {} : { limit }),
      ...(cursor == null ? {} : { cursor }),
    }

    return ok(await photos.list(eventId, query))
  }
}
