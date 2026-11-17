import { GUEST_SAVE_EXTENSION, GUEST_SAVE_RENDITION } from '../../../domain/photos/guestSave'
import type { ContentHash } from '../../../domain/photos/contentHash'
import type { ServedVariant } from '../../../domain/photos/mediaVariant'
import { isVisibleOnWall } from '../../../domain/photos/photoStatus'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventRepository } from '../../ports/eventRepository'
import type { MediaStore } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { PhotoMedia } from './getPhotoMedia'

/**
 * The bytes of one photograph a guest saves from the feed (spec 24).
 *
 * **Who is asking is not an input.** The route sits behind `requireGuest`, which has already
 * proved a non-revoked guest of *this* event, and nothing here depends on which guest it is: a
 * guest's own photograph is accepted like any other (the button simply does not offer it), and a
 * revoked guest never gets this far. A parameter nobody reads would only be a place for a caller
 * to put a value the request supplied.
 *
 * ## The order of the checks is part of the control
 *
 * 1. **The event still serves its wall** (`servesPublicWall`: neither a draft, nor archived, nor
 *    taken down by the operator, nor its client suspended). `requireGuest` deliberately ignores
 *    the lifecycle, so this is the one place a guest of an archived evening is stopped.
 *    `event.notFound`.
 * 2. **The host's switch**, read now and never remembered: `save.disabled`. The one refusal that
 *    names itself, because a guest may know the host turned it off, and the feed that was open
 *    when they did is told by this very answer (it has no live channel).
 * 3. **The row, scoped by the event** (`findById(eventId, photoId)`): another event's photograph
 *    and one the operator took down answer nothing.
 * 4. **A still, visible to the public**: the rendition table says which kinds are saved, and the
 *    status is the wall's own (`isVisibleOnWall`). A photograph awaiting moderation, hidden or
 *    refused is not saveable, **not even by its author**: the route is no way around the host.
 * 5. **The bytes exist.**
 *
 * Every refusal of a photograph is `photo.notFound`, identical to an unknown id, so the route is
 * not an oracle for which ids exist or what state they are in. `photo.mediaMissing` is the one
 * exception, the code the project already uses for a row whose file is gone.
 *
 * Nothing is kept: no row of who saved what, no copy, no cache.
 */

export interface SaveGuestPhotoInput {
  readonly eventId: EventId
  readonly photoId: PhotoId
}

/** What the route needs to write the headers, plus the one function that opens the bytes. */
export interface GuestSave extends Pick<PhotoMedia, 'contentHash' | 'byteSize' | 'contentType'> {
  readonly variant: ServedVariant
  /**
   * What the file is saved as: `<slug>-<short digest>.jpg`, chosen here from the event's slug and
   * the digest. No name, caption or date a guest typed or a camera wrote reaches it.
   */
  readonly fileName: string
  /** Opens the bytes. **Call it at most once**, and only once the whole decision is made. */
  readonly open: PhotoMedia['open']
}

export interface SaveGuestPhotoDeps {
  readonly events: EventRepository
  readonly photos: PhotoRepository
  readonly media: MediaStore
}

export type SaveGuestPhoto = (input: SaveGuestPhotoInput) => Promise<Result<GuestSave, DomainError>>

export const makeSaveGuestPhoto =
  ({ events, photos, media }: SaveGuestPhotoDeps): SaveGuestPhoto =>
  async ({ eventId, photoId }) => {
    const event = await events.findById(eventId)
    if (event === null || !event.servesPublicWall()) {
      return err(DomainError.notFound('event.notFound'))
    }

    if (!event.settings.allowGuestSave) return err(DomainError.forbidden('save.disabled'))

    const photo = await photos.findById(eventId, photoId)
    if (photo === null) return err(DomainError.notFound('photo.notFound'))

    const variant = GUEST_SAVE_RENDITION[photo.kind]
    if (variant === null || !photo.hasVariant(variant)) {
      return err(DomainError.notFound('photo.notFound'))
    }
    if (!isVisibleOnWall(photo.status)) return err(DomainError.notFound('photo.notFound'))

    const hash: ContentHash = photo.hashFor(variant)
    const metadata = await media.stat(eventId, hash, variant)
    if (metadata === null) return err(DomainError.notFound('photo.mediaMissing'))

    return ok({
      contentHash: hash,
      variant,
      byteSize: metadata.byteSize,
      contentType: metadata.contentType,
      fileName: `${event.slug.value}-${hash.short}.${GUEST_SAVE_EXTENSION[photo.kind]}`,
      open: (range) => media.openRead(eventId, hash, variant, range),
    })
  }
