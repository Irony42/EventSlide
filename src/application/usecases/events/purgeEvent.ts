import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventRepository } from '../../ports/eventRepository'
import type { MediaStore } from '../../ports/mediaStore'
import type { MembershipRepository } from '../../ports/userRepository'
import { requireEventRole, requireWritable } from '../shared/eventRole'

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

    const allowed = await requireEventRole(memberships, eventId, actorId, 'delete')
    if (!allowed.ok) return allowed

    const writable = requireWritable(event)
    if (!writable.ok) return writable

    // The operator holds this event's purge, to preserve evidence (launch review S5). The refusal is
    // **the failure a purge can already end in** (`event.mediaPurgeFailed`), not a code that exists
    // only under a hold: the host is not told why (runbook csam.md). The operator-side meaning is
    // in the audit log (`event.purgeHeld`).
    const unavailable = (): Result<never, DomainError> =>
      err(DomainError.unexpected('event.mediaPurgeFailed'))
    if (event.isPurgeHeld()) return unavailable()

    // **The row first, conditionally, then the bytes.** The check above is a read; a hold set
    // after it must still win, so the delete refuses a held row in the same statement and the
    // bytes are only touched once it answered `true`: the files of a held event are never
    // removed, whatever happened since. One statement: `ON DELETE CASCADE` removes the photos,
    // guests, reactions and memberships in the same transaction.
    if (!(await events.deleteUnlessHeld(event.id))) return unavailable()

    try {
      await media.deleteEvent(event.id)
    } catch {
      // A read-only media root or a disk that went away. The row is already gone, so the bytes are
      // left for `sweepOrphanedMedia`, which collects what no row names once it is old enough.
      return err(DomainError.unexpected('event.mediaPurgeFailed'))
    }

    return ok(undefined)
  }
