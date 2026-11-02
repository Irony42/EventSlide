import { isHighlightable } from '../../../domain/highlights/highlightEligibility'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { PhotoRepository } from '../../ports/photoRepository'
import { requireWritable } from '../shared/eventRole'

/**
 * The host stars a photograph as a favourite, or takes the star off (spec 08).
 *
 * Starring is a moderation decision, so the guard is exactly `moderatePhoto`'s: a suspended
 * client or a taken-down event is refused first, then an archived event (a record nobody
 * moderates). Who may ask is the route's `requireRole('moderator')`.
 *
 * Idempotent both ways. Only a published photograph takes a star: the repository decides that
 * in the write itself, so a moderation landing between the read and the write cannot leave a
 * star on a hidden photograph.
 */

export interface SetPhotoHighlightInput {
  readonly eventId: EventId
  readonly photoId: PhotoId
  readonly highlighted: boolean
}

export interface SetPhotoHighlightDeps {
  readonly events: Pick<EventRepository, 'findById'>
  readonly photos: PhotoRepository
  readonly clock: Clock
}

export type SetPhotoHighlight = (
  input: SetPhotoHighlightInput,
) => Promise<Result<void, DomainError>>

export const makeSetPhotoHighlight =
  ({ events, photos, clock }: SetPhotoHighlightDeps): SetPhotoHighlight =>
  async ({ eventId, photoId, highlighted }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const writable = requireWritable(event)
    if (!writable.ok) return writable
    if (!event.allowsModeration()) {
      return err(DomainError.conflict('event.notModeratable', { status: event.status }))
    }

    // Scoped read: another event's photograph is "not found", whatever its status.
    const photo = await photos.findById(eventId, photoId)
    if (photo === null) return err(DomainError.notFound('photo.notFound'))

    if (highlighted && !isHighlightable(photo.status)) {
      return err(DomainError.conflict('highlight.notPublished', { status: photo.status }))
    }

    const done = await photos.setHighlighted(eventId, photoId, highlighted ? clock.now() : null)
    // The write refuses what the read allowed only when the photograph moved in between.
    if (!done) return err(DomainError.conflict('highlight.notPublished'))
    return ok(undefined)
  }
