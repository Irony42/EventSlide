import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventRepository } from '../../ports/eventRepository'
import type { MissionRepository } from '../../ports/missionRepository'
import type { PhotoPage, PhotoQuery, PhotoRepository } from '../../ports/photoRepository'

/**
 * "Mes photos" on a guest's phone: everything that one guest sent to this event.
 *
 * Deliberately unfiltered by status. A guest sees their own `pending` photo shown as
 * awaiting moderation and their own `rejected` photo shown as declined, because the
 * alternative — an upload that succeeded and then vanished from their phone — is the
 * single most common support question a host gets during an event, and it makes the
 * guest send the photo again.
 *
 * Both the event and the guest are part of the query. A device token is issued for one
 * event, and this read cannot be widened past it.
 */

export interface ListGuestPhotosInput {
  readonly eventId: EventId
  readonly guestId: GuestId
  readonly limit?: number | null
  readonly cursor?: string | null
}

export interface ListGuestPhotosDeps {
  readonly events: EventRepository
  readonly photos: PhotoRepository
  readonly missions: MissionRepository
}

/**
 * The guest's page of photos, with the words of the missions they were filed under.
 *
 * `missionPrompts` holds an entry only for a mission that still exists: a photo whose mission the
 * host has since deleted reads as filed under none, which is what the guest can still act on.
 */
export interface GuestPhotoPage extends PhotoPage {
  readonly missionPrompts: ReadonlyMap<string, string>
}

export type ListGuestPhotos = (
  input: ListGuestPhotosInput,
) => Promise<Result<GuestPhotoPage, DomainError>>

export const makeListGuestPhotos = ({
  events,
  photos,
  missions,
}: ListGuestPhotosDeps): ListGuestPhotos => {
  return async ({ eventId, guestId, limit, cursor }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const query: PhotoQuery = {
      authoredBy: guestId,
      ...(limit == null ? {} : { limit }),
      ...(cursor == null ? {} : { cursor }),
    }

    const page = await photos.list(eventId, query)
    // Only the missions this page names, and only their words: this is the read a phone repeats
    // while it waits, so it must not pay for the event-wide progress counts.
    const missionIds = [
      ...new Set(page.items.flatMap((photo) => (photo.missionId === null ? [] : [photo.missionId]))),
    ]
    const missionPrompts = new Map<string, string>()
    if (missionIds.length > 0) {
      for (const mission of await missions.findByIds(eventId, missionIds)) {
        missionPrompts.set(mission.id, mission.prompt.value)
      }
    }
    return ok({ ...page, missionPrompts })
  }
}
