import type { PhotoActor } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { MediaStore } from '../../ports/mediaStore'
import type { ClipJobRepository } from '../../ports/clipJobRepository'
import type { PhotoRepository } from '../../ports/photoRepository'
import { requireWritable } from '../shared/eventRole'
import { makeRemovePhotoRecord } from './removePhotoRecord'

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
  /**
   * The transcode queue, because deleting a clip has to retire the job that made it.
   * A photograph's delete never touches it, and a use case is the right place for that:
   * neither repository can see the other.
   */
  readonly clips: ClipJobRepository
  readonly media: MediaStore
  readonly bus: EventBus
  readonly clock: Clock
}

export type DeletePhoto = (input: DeletePhotoInput) => Promise<Result<void, DomainError>>

export const makeDeletePhoto = ({
  events,
  photos,
  clips,
  media,
  bus,
  clock,
}: DeletePhotoDeps): DeletePhoto => {
  const removePhotoRecord = makeRemovePhotoRecord({ photos, media, clock })

  return async ({ eventId, photoId, actor }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const writable = requireWritable(event)
    if (!writable.ok) return writable

    // Scoped read: passing `eventId` is what makes a photo of another event a 404
    // rather than a deletion.
    const photo = await photos.findById(eventId, photoId)
    if (photo === null) return err(DomainError.notFound('photo.notFound'))

    // One verdict, which the guest's `canDelete` flag is read from as well (`deletionVerdict`): the
    // host's switch over the whole feature (a wedding where the album is the point, and a guest
    // changing their mind at midnight is the host's decision to make), then the photo's own rule.
    const verdict = photo.deletionVerdict(actor, clock.now(), event.settings)
    if (verdict === 'selfDeleteDisabled') {
      return err(DomainError.forbidden('event.guestSelfDeleteDisabled'))
    }
    if (verdict === 'forbidden') return err(DomainError.forbidden('photo.deleteForbidden'))

    // Bytes first, then the row; `removePhotoRecord` carries the argument and the guards.
    await removePhotoRecord(eventId, photo)

    // **And the clip job that produced it, if there was one.** A `done` job blocks the
    // dedupe, so a guest who deleted their own clip by mistake and sent it again was
    // answered `duplicate: true`, `status: done`, and the id of a row that no longer
    // existed — their video never came back, and nothing in the product could bring it.
    // A no-op for a photograph, so this path does not have to know which it is holding.
    await clips.deleteForPhoto(eventId, photoId)

    bus.publish({ type: 'photo.deleted', eventId, photoId })
    return ok(undefined)
  }
}
