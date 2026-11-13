import { Caption } from '../../../domain/photos/caption'
import type { PhotoActor } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { PhotoRepository } from '../../ports/photoRepository'
import { isInBook } from '../../../domain/book/isInBook'
import { requireEditable, requireWritable } from '../shared/eventRole'
import type { InvalidateBook } from '../book/invalidateAlbumBook'

/**
 * Write or clear the line projected under a photo.
 *
 * `Photo.canCaptionBeEditedBy` owns who may: a guest only on their own still-pending photo
 * and only inside the grace window — once a caption is on the wall in front of the room,
 * changing it is the host's call, and a host is a moderator or owner of **this** event (the
 * caller resolves the role; none is a refusal).
 *
 * The event's state is asked first: an event the operator took down is not there, a suspended
 * client's guests write nothing, an archived event is a record. A **closed** event takes no new
 * text from a guest (their uploads are closed too), but still lets them clear their own caption:
 * taking words back off a photograph is never what closing was meant to prevent, and a guest
 * may want to for a privacy reason.
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
  /**
   * Retires a photo book that prints captions when a published photograph's caption changes
   * (spec 04): a guest may take a caption back for a privacy reason, and the book is a copy.
   */
  readonly invalidateBook?: InvalidateBook
}

export type SetPhotoCaption = (
  input: SetPhotoCaptionInput,
) => Promise<Result<void, DomainError>>

export const makeSetPhotoCaption = ({
  events,
  photos,
  bus,
  clock,
  invalidateBook,
}: SetPhotoCaptionDeps): SetPhotoCaption => {
  return async ({ eventId, photoId, actor, caption }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const writable = requireWritable(event)
    if (!writable.ok) return writable
    const editable = requireEditable(event)
    if (!editable.ok) return editable

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
    if (parsed.value !== null && actor.kind === 'guest' && !event.acceptsUploads()) {
      return err(DomainError.conflict('event.notAcceptingUploads', { status: event.status }))
    }

    if (isInBook(photo.status)) await invalidateBook?.(eventId, 'captionChanged')
    await photos.save(photo.withCaption(parsed.value))

    bus.publish({ type: 'photo.captionChanged', eventId, photoId })
    return ok(undefined)
  }
}
