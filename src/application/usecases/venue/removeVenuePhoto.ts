import type { Event } from '../../../domain/events/event'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { Logger } from '../../ports/logger'
import type { MediaStore } from '../../ports/mediaStore'
import type { MembershipRepository } from '../../ports/userRepository'
import { requireEventRole, requireWritable } from '../shared/eventRole'

/**
 * The host takes their venue photograph back down: the ambiance shows its bundled ground again.
 *
 * Owner only, like putting it up. **Idempotent**: removing what is not there answers the event
 * unchanged, because the form's second tap and a retry after a dropped connection both mean
 * "I want none", and the second one is already true.
 *
 * Row first, bytes second: the opposite order to `setVenuePhoto`, for the same reason read the
 * other way. The row is what makes a file reachable, so it goes first, and a delete that then
 * fails leaves an unreachable file for `sweepOrphanedMedia` instead of a settings row naming
 * bytes that are gone.
 */

export interface RemoveVenuePhotoInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface RemoveVenuePhotoDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
  readonly media: MediaStore
  readonly bus: EventBus
  readonly logger: Logger
}

export type RemoveVenuePhoto = (input: RemoveVenuePhotoInput) => Promise<Result<Event, DomainError>>

export const makeRemoveVenuePhoto =
  ({ events, memberships, media, bus, logger }: RemoveVenuePhotoDeps): RemoveVenuePhoto =>
  async ({ eventId, actorId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const allowed = await requireEventRole(memberships, eventId, actorId, 'manage')
    if (!allowed.ok) return allowed

    const writable = requireWritable(event)
    if (!writable.ok) return writable

    // A held event keeps every file it has, the venue photograph's included (launch review S5).
    // Answered with a failure the host can already get, not one that exists only under a hold.
    if (event.isPurgeHeld()) return err(DomainError.unexpected('venuePhoto.saveFailed'))

    const previous = event.settings.venuePhoto
    if (previous === null) return ok(event)

    const updated = event.withSettings(event.settings.withVenuePhoto(null))
    if (!updated.ok) return updated

    await events.save(updated.value)
    bus.publish({ type: 'event.settingsChanged', eventId })

    try {
      await media.delete(eventId, previous)
    } catch (cause) {
      logger.warn('could not remove a venue photo; leaving it for the sweep', {
        eventId,
        cause: String(cause),
      })
    }

    return ok(updated.value)
  }
