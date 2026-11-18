import { isVoiceOpen } from '../../../domain/events/eventGuestbookVoiceSettings'
import type { GuestbookEntry, EntryStatus } from '../../../domain/guestbook/guestbookEntry'
import { MAX_ENTRIES_PER_EVENT } from '../../../domain/guestbook/guestbookLimits'
import {
  orderGuestbookQueue,
  pendingGuestbookCount,
} from '../../../domain/guestbook/guestbookQueue'
import { isVoiceInFlight } from '../../../domain/guestbook/guestbookVoiceState'
import type { PhotoActor } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestRepository } from '../../ports/guestRepository'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { requireEventRole, requireReadable } from '../shared/eventRole'

/**
 * The host's reading of the guestbook (spec 01): every message with its author's first name,
 * what needs a decision first (`orderGuestbookQueue`), at most `limit` rows.
 *
 * The whole book is read (500 rows at the most, a ceiling the domain holds) before the order and
 * the limit apply, so a limit can never push the oldest pending message off the page, and the
 * pending count is the book's and not the page's. A name the guest never gave, or whose row is
 * gone, is `null`: the client owns the wording. Readable in any state but a suspended client's,
 * archived included (a record); the operator's taken-down rows never come back from the
 * repository.
 *
 * **A voice message** (spec 25) is listed only once `ready`: until then there is nothing to listen
 * to and nothing to decide (`allowedDecisions` would be empty), so the rows are left out of the
 * list **and of the pending count** and told apart as a number, `voice.processing`, that the
 * console words ("2 messages vocaux en traitement"). `voice` also says whether the secret is
 * still on (the console shows no player, and says so) and the server's clock, so a console whose
 * laptop clock is wrong still counts down to the right instant.
 */

export interface ListGuestbookQueueInput {
  readonly eventId: EventId
  /** One status, or every one. */
  readonly status: EntryStatus | null
  readonly limit: number
  readonly actor: PhotoActor
}

export interface GuestbookQueueRow {
  readonly entry: GuestbookEntry
  readonly authorName: string | null
}

/** What the host's reading says about the voice messages of the book (spec 25). */
export interface GuestbookQueueVoice {
  /** Recordings still being processed, which the list leaves out: `reserved`, `queued`, `running`. */
  readonly processing: number
  /** The secret is still on: nobody may listen yet (`isVoiceOpen` is false). */
  readonly sealed: boolean
  /** When the host set the secret to lift, as an instant, or `null` for "when the event ends". */
  readonly opensAtMs: number | null
  /** The server's now, so the console never trusts the laptop's clock for a countdown. */
  readonly nowMs: number
}

export interface GuestbookQueueView {
  readonly items: readonly GuestbookQueueRow[]
  readonly pendingCount: number
  readonly voice: GuestbookQueueVoice
}

export interface ListGuestbookQueueDeps {
  readonly events: EventRepository
  readonly guestbook: GuestbookRepository
  readonly guests: GuestRepository
  readonly memberships: MembershipRepository
  readonly clock: Clock
}

export type ListGuestbookQueue = (
  input: ListGuestbookQueueInput,
) => Promise<Result<GuestbookQueueView, DomainError>>

const ALL: readonly EntryStatus[] = ['pending', 'published', 'hidden', 'rejected']

export const makeListGuestbookQueue =
  ({ events, guestbook, guests, memberships, clock }: ListGuestbookQueueDeps): ListGuestbookQueue =>
  async ({ eventId, status, limit, actor }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    if (actor.kind === 'guest') {
      return err(DomainError.forbidden('auth.forbidden', { required: 'moderator' }))
    }

    const allowed = await requireEventRole(memberships, eventId, actor.userId, 'moderate')
    if (!allowed.ok) return allowed

    const readable = requireReadable(event)
    if (!readable.ok) return readable

    const now = clock.now()

    // The pending count is the whole book's, whatever the tab: every status is read once.
    const everything = await guestbook.listByStatuses(eventId, ALL, MAX_ENTRIES_PER_EVENT)
    const book = everything.filter((entry) => entry.isDecidable())
    const processing = everything.filter(
      (entry) => entry.voice !== null && isVoiceInFlight(entry.voice.state),
    ).length
    const shown = status === null ? book : book.filter((entry) => entry.status === status)
    const page = orderGuestbookQueue(shown).slice(0, limit)

    const senders = new Set<GuestId>(page.map((entry) => entry.guestId))
    const names = await guests.findNamesByIds(eventId, [...senders])

    return ok({
      items: page.map((entry) => ({ entry, authorName: names.get(entry.guestId) ?? null })),
      pendingCount: pendingGuestbookCount(book),
      voice: {
        processing,
        sealed: !isVoiceOpen(event.settings.guestbookVoice, event, now),
        opensAtMs: event.settings.guestbookVoice.opensAtMs,
        nowMs: now.getTime(),
      },
    })
  }
