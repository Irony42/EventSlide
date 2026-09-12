import type { PhotoActor } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { MediaStore } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'

/**
 * Remove a photo, for a host at any time or for the guest who regrets it.
 *
 * The permission decision is `Photo.canBeDeletedBy` and is not restated here: hosts
 * always may, a guest may take back their own photo inside the grace window and only
 * while it has not reached the wall. The use case supplies the two things the entity
 * cannot know — the current time and the event's configured window — and owns the two
 * things the entity has no business owning: the event-scoped read, and the order of the
 * two deletions.
 */

export interface DeletePhotoInput {
  readonly eventId: EventId
  readonly photoId: PhotoId
  readonly actor: PhotoActor
}

export interface DeletePhotoDeps {
  readonly events: EventRepository
  readonly photos: PhotoRepository
  readonly media: MediaStore
  readonly bus: EventBus
  readonly clock: Clock
}

export type DeletePhoto = (input: DeletePhotoInput) => Promise<Result<void, DomainError>>

export const makeDeletePhoto = ({
  events,
  photos,
  media,
  bus,
  clock,
}: DeletePhotoDeps): DeletePhoto => {
  return async ({ eventId, photoId, actor }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    // Scoped read: passing `eventId` is what makes a photo of another event a 404
    // rather than a deletion.
    const photo = await photos.findById(eventId, photoId)
    if (photo === null) return err(DomainError.notFound('photo.notFound'))

    const settings = event.settings

    // The host can switch self-deletion off entirely — a wedding where the album is the
    // point, and a guest changing their mind at midnight is the host's decision to make.
    if (actor.kind === 'guest' && !settings.allowGuestSelfDelete) {
      return err(DomainError.forbidden('event.guestSelfDeleteDisabled'))
    }

    if (!photo.canBeDeletedBy(actor, clock.now(), settings.guestSelfDeleteGraceMs)) {
      return err(DomainError.forbidden('photo.deleteForbidden'))
    }

    // Media first: the row is the only record of the file's address, so removing it
    // first would strand bytes nobody can name — neither this use case nor the
    // retention purge could ever find them again. A crash between the two leaves a row
    // whose file is gone, which the media endpoint already answers as a 404.
    //
    // **Every digest the row owns, not just `contentHash`.** A clip owns two: the mp4
    // under its own and the poster under a second, because the store's invariant is that
    // a file's name is that file's hash. Deleting `contentHash` alone removed the video
    // and left the poster behind on every guest self-delete and every host delete.
    for (const hash of photo.storageHashes) await media.delete(eventId, hash)
    await photos.delete(eventId, photoId)

    bus.publish({ type: 'photo.deleted', eventId, photoId })
    return ok(undefined)
  }
}
