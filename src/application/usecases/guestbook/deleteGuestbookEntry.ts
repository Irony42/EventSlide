import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId, GuestbookEntryId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import { isReachableByGuests } from './createGuestbookEntry'

/**
 * A guest takes back one of their own messages (spec 01).
 *
 * **The photograph's rule, not a rule of its own** (`GuestbookEntry.deletionVerdict`): the host's
 * `allowGuestSelfDelete` switch over the feature, then the author, inside the grace window, while
 * the message is not yet on the wall. A guest who wants a published message gone uses "delete
 * everything I sent" (`eraseGuestContribution`), which this rule does not gate.
 *
 * The lookup is by `(eventId, entryId)` and then by author: another guest's message, another
 * event's and one the operator took down are all the same `guestbook.notFound`, so a guest learns
 * nothing about a message that is not theirs. The purge hold is asked **after** the lookup, so an
 * unknown id stays a 404, and is answered with the generic failure `deletePhoto` gives: the host
 * is not told there is a hold.
 */

export interface DeleteGuestbookEntryInput {
  readonly eventId: EventId
  readonly entryId: GuestbookEntryId
  /** The guest the device token proves. */
  readonly guestId: GuestId
}

export interface DeleteGuestbookEntryDeps {
  readonly events: EventRepository
  readonly guestbook: GuestbookRepository
  readonly bus: EventBus
  readonly clock: Clock
}

export type DeleteGuestbookEntry = (
  input: DeleteGuestbookEntryInput,
) => Promise<Result<void, DomainError>>

export const makeDeleteGuestbookEntry =
  ({ events, guestbook, bus, clock }: DeleteGuestbookEntryDeps): DeleteGuestbookEntry =>
  async ({ eventId, entryId, guestId }) => {
    const event = await events.findById(eventId)
    if (event === null || !isReachableByGuests(event)) {
      return err(DomainError.notFound('event.notFound'))
    }

    const entry = await guestbook.findById(eventId, entryId)
    if (entry === null || !entry.isAuthoredBy(guestId)) {
      return err(DomainError.notFound('guestbook.notFound'))
    }

    if (event.isPurgeHeld()) return err(DomainError.unexpected('guestbook.deleteFailed'))

    const verdict = entry.deletionVerdict({ kind: 'guest', guestId }, clock.now(), {
      allowGuestSelfDelete: event.settings.allowGuestSelfDelete,
      guestSelfDeleteGraceMs: event.settings.guestSelfDeleteGraceSeconds * 1_000,
    })
    if (verdict === 'selfDeleteDisabled') {
      return err(DomainError.forbidden('event.guestSelfDeleteDisabled'))
    }
    if (verdict === 'forbidden') return err(DomainError.forbidden('guestbook.deleteForbidden'))

    await guestbook.delete(eventId, entryId)
    bus.publish({ type: 'guestbook.changed', eventId })
    return ok(undefined)
  }
