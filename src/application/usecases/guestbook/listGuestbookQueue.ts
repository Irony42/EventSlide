import type { GuestbookEntry, EntryStatus } from '../../../domain/guestbook/guestbookEntry'
import { MAX_ENTRIES_PER_EVENT } from '../../../domain/guestbook/guestbookLimits'
import {
  orderGuestbookQueue,
  pendingGuestbookCount,
} from '../../../domain/guestbook/guestbookQueue'
import type { PhotoActor } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
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

export interface GuestbookQueueView {
  readonly items: readonly GuestbookQueueRow[]
  readonly pendingCount: number
}

export interface ListGuestbookQueueDeps {
  readonly events: EventRepository
  readonly guestbook: GuestbookRepository
  readonly guests: GuestRepository
  readonly memberships: MembershipRepository
}

export type ListGuestbookQueue = (
  input: ListGuestbookQueueInput,
) => Promise<Result<GuestbookQueueView, DomainError>>

const ALL: readonly EntryStatus[] = ['pending', 'published', 'hidden', 'rejected']

export const makeListGuestbookQueue =
  ({ events, guestbook, guests, memberships }: ListGuestbookQueueDeps): ListGuestbookQueue =>
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

    // The pending count is the whole book's, whatever the tab: every status is read once.
    const book = await guestbook.listByStatuses(eventId, ALL, MAX_ENTRIES_PER_EVENT)
    const shown = status === null ? book : book.filter((entry) => entry.status === status)
    const page = orderGuestbookQueue(shown).slice(0, limit)

    const senders = new Set<GuestId>(page.map((entry) => entry.guestId))
    const names = await guests.findNamesByIds(eventId, [...senders])

    return ok({
      items: page.map((entry) => ({ entry, authorName: names.get(entry.guestId) ?? null })),
      pendingCount: pendingGuestbookCount(book),
    })
  }
