import type { GuestbookEntry } from '../../../domain/guestbook/guestbookEntry'
import { MAX_ENTRIES_PER_GUEST } from '../../../domain/guestbook/guestbookLimits'
import { acceptsGuestbookEntries } from '../../../domain/guestbook/guestbookWindow'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import { isReachableByGuests } from './createGuestbookEntry'

/**
 * A guest's own messages and whether a new one would be taken (spec 01).
 *
 * `mine`, never a guest id from the request: whose list it is comes from the device token. Every
 * status is shown to its author (a refused message as declined, a pending one as waiting), except
 * what the operator took down, which no read of the repository returns.
 *
 * `canDelete` is the entry's own verdict (`GuestbookEntry.deletionVerdict`, the photograph's
 * rule), so the phone is never shown a button the delete route then refuses. `accepting` is the
 * rule the write route applies (the switch, the event's state and the closed-event window), so the
 * card can disappear instead of offering a form the server will refuse.
 */

export interface ListMyGuestbookEntriesInput {
  readonly eventId: EventId
  readonly guestId: GuestId
}

export interface MyGuestbookEntry {
  readonly entry: GuestbookEntry
  readonly canDelete: boolean
}

export interface MyGuestbook {
  readonly items: readonly MyGuestbookEntry[]
  readonly accepting: boolean
  /** Whether published messages are shown on the wall: what "published" means to the author. */
  readonly onWall: boolean
}

export interface ListMyGuestbookEntriesDeps {
  readonly events: EventRepository
  readonly guestbook: GuestbookRepository
  readonly clock: Clock
}

export type ListMyGuestbookEntries = (
  input: ListMyGuestbookEntriesInput,
) => Promise<Result<MyGuestbook, DomainError>>

export const makeListMyGuestbookEntries =
  ({ events, guestbook, clock }: ListMyGuestbookEntriesDeps): ListMyGuestbookEntries =>
  async ({ eventId, guestId }) => {
    const event = await events.findById(eventId)
    if (event === null || !isReachableByGuests(event)) {
      return err(DomainError.notFound('event.notFound'))
    }

    const now = clock.now()
    const actor = { kind: 'guest', guestId } as const
    const entries = await guestbook.listByGuest(eventId, guestId, MAX_ENTRIES_PER_GUEST)

    return ok({
      items: entries.map((entry) => ({
        entry,
        canDelete:
          entry.deletionVerdict(actor, now, {
            allowGuestSelfDelete: event.settings.allowGuestSelfDelete,
            guestSelfDeleteGraceMs: event.settings.guestSelfDeleteGraceSeconds * 1_000,
          }) === 'allowed',
      })),
      accepting: event.settings.allowGuestbook && acceptsGuestbookEntries(event, now),
      onWall: event.settings.guestbookOnWall,
    })
  }
