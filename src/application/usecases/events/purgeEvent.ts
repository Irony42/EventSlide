import { canDeleteEvent } from '../../../domain/events/eventRole'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventRepository } from '../../ports/eventRepository'
import type { MediaStore } from '../../ports/mediaStore'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * Delete an event and everything it ever held. Not undoable.
 *
 * Owner only, and there is no confirmation step to model here: the cascade takes every
 * photo, guest, reaction and membership of the event with the row.
 */

export interface PurgeEventInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface PurgeEventDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
  readonly media: MediaStore
}

export type PurgeEvent = (input: PurgeEventInput) => Promise<Result<void, DomainError>>

export const makePurgeEvent =
  ({ events, memberships, media }: PurgeEventDeps): PurgeEvent =>
  async ({ eventId, actorId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const role = await memberships.roleFor(eventId, actorId)
    // `notFound` rather than `forbidden` for a caller with no part in the event, so
    // this cannot be used to discover that the event exists.
    if (role === null) return err(DomainError.notFound('event.notFound'))
    if (!canDeleteEvent(role)) {
      return err(DomainError.forbidden('auth.forbidden', { required: 'owner' }))
    }

    // Media first, row second, and the order is the whole point. The row is the only
    // record that this event's bytes exist: delete it first and a failure here leaves
    // gigabytes on the disk with nothing left to find them by. This way a failure
    // leaves a purge that can simply be run again.
    try {
      await media.deleteEvent(event.id)
    } catch {
      // A read-only media root or a disk that went away. Reported rather than thrown so
      // the retention job can move on to the next event, and so the row survives to be
      // purged again.
      return err(DomainError.unexpected('event.mediaPurgeFailed'))
    }

    // One statement: `ON DELETE CASCADE` removes the photos, guests, reactions and
    // memberships in the same transaction.
    await events.delete(event.id)

    return ok(undefined)
  }
