import type { Event } from '../../../domain/events/event'
import { GuestbookEntry } from '../../../domain/guestbook/guestbookEntry'
import { GuestbookText } from '../../../domain/guestbook/guestbookText'
import { acceptsGuestbookEntries } from '../../../domain/guestbook/guestbookWindow'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import {
  MAX_ENTRIES_PER_EVENT,
  MAX_ENTRIES_PER_GUEST,
} from '../../../domain/guestbook/guestbookLimits'

/**
 * A guest leaves a written message (spec 01).
 *
 * **The author is the device token**: `guestId` is the one `requireGuest` proved, never a value a
 * request names, so there is nobody else to write as. Everything is scoped by `eventId`.
 *
 * The gates, in the order a guest can act on them: the event is still there for them (not taken
 * down, client not suspended: a second line behind `authenticateGuest`), the event takes messages
 * now (`acceptsGuestbookEntries`: live, or closed for seven days), the host switched the guestbook
 * on, then the text is judged by `GuestbookText`. The ceilings and the "same message twice" rule
 * are the repository's, decided inside one write transaction with the same function the fake
 * runs, so a guest at their limit who double-taps is told "sent" and not "too many".
 *
 * The message meets the moderation of the event: published on arrival in `auto`, held in `manual`
 * (`GuestbookEntry.create`). The bus hears of it unless it was a duplicate, because only then did
 * something change; it hears of a `pending` message too, so the host's panel moves.
 */

export interface CreateGuestbookEntryInput {
  readonly eventId: EventId
  /** The guest the device token proves. */
  readonly guestId: GuestId
  /** Untrusted: parsed here. */
  readonly text: unknown
}

export interface CreatedGuestbookEntry {
  readonly entry: GuestbookEntry
  /** The same guest sent the same text a moment ago: this is that message, and nothing is new. */
  readonly duplicate: boolean
}

export interface CreateGuestbookEntryDeps {
  readonly events: EventRepository
  readonly guestbook: GuestbookRepository
  readonly ids: IdGenerator
  readonly bus: EventBus
  readonly clock: Clock
}

export type CreateGuestbookEntry = (
  input: CreateGuestbookEntryInput,
) => Promise<Result<CreatedGuestbookEntry, DomainError>>

/** Whether this event reaches its guests at all: the operator's two levers, as `authenticateGuest` reads them. */
export const isReachableByGuests = (event: Event): boolean =>
  !event.isTakenDown() && !event.isClientSuspended()

export const makeCreateGuestbookEntry =
  ({ events, guestbook, ids, bus, clock }: CreateGuestbookEntryDeps): CreateGuestbookEntry =>
  async ({ eventId, guestId, text }) => {
    const event = await events.findById(eventId)
    if (event === null || !isReachableByGuests(event)) {
      return err(DomainError.notFound('event.notFound'))
    }

    const now = clock.now()
    if (!acceptsGuestbookEntries(event, now)) {
      return err(DomainError.conflict('event.notAcceptingUploads', { status: event.status }))
    }
    if (!event.settings.allowGuestbook) return err(DomainError.conflict('guestbook.disabled'))

    const parsed = GuestbookText.create(text)
    if (!parsed.ok) return parsed

    const entry = GuestbookEntry.create(
      { eventId, guestId, text: parsed.value },
      ids.guestbookEntryId(),
      now,
      event.settings.moderation,
    )

    const admission = await guestbook.admit(entry)
    switch (admission.kind) {
      case 'refused':
        return err(
          admission.refusal === 'guestLimit'
            ? DomainError.conflict('guestbook.limitReached', { max: MAX_ENTRIES_PER_GUEST })
            : DomainError.conflict('guestbook.eventFull', { max: MAX_ENTRIES_PER_EVENT }),
        )
      case 'duplicate':
        return ok({ entry: admission.entry, duplicate: true })
      case 'added':
        bus.publish({ type: 'guestbook.changed', eventId })
        return ok({ entry: admission.entry, duplicate: false })
    }
  }
