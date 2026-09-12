import { Caption } from '../../../domain/photos/caption'
import type { PhotoActor } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { PhotoRepository } from '../../ports/photoRepository'

/**
 * Write or clear the line projected under a photo.
 *
 * `Photo.canCaptionBeEditedBy` owns who may: a host always, a guest only on their own
 * still-pending photo and only inside the grace window — once a caption is on the wall
 * in front of the room, changing it is the host's call.
 *
 * Clearing a caption is allowed even on an event that has since turned captions off,
 * because removing text from the wall can never be the thing the setting was meant to
 * prevent.
 */

export interface SetPhotoCaptionInput {
  readonly eventId: EventId
  readonly photoId: PhotoId
  readonly actor: PhotoActor
  /** `null`, blank or whitespace-only clears it. */
  readonly caption: string | null
}

export interface SetPhotoCaptionDeps {
  readonly events: EventRepository
  readonly photos: PhotoRepository
  readonly bus: EventBus
  readonly clock: Clock
}

export type SetPhotoCaption = (
  input: SetPhotoCaptionInput,
) => Promise<Result<void, DomainError>>

export const makeSetPhotoCaption = ({
  events,
  photos,
  bus,
  clock,
}: SetPhotoCaptionDeps): SetPhotoCaption => {
  return async ({ eventId, photoId, actor, caption }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const photo = await photos.findById(eventId, photoId)
    if (photo === null) return err(DomainError.notFound('photo.notFound'))

    const settings = event.settings

    if (!photo.canCaptionBeEditedBy(actor, clock.now(), settings.guestSelfDeleteGraceMs)) {
      return err(DomainError.forbidden('photo.captionEditForbidden'))
    }

    const parsed = Caption.createOptional(caption)
    if (!parsed.ok) return parsed
    if (parsed.value !== null && !settings.allowCaptions) {
      return err(DomainError.forbidden('event.captionsNotAllowed'))
    }

    await photos.save(photo.withCaption(parsed.value))

    bus.publish({ type: 'photo.captionChanged', eventId, photoId })
    return ok(undefined)
  }
}
