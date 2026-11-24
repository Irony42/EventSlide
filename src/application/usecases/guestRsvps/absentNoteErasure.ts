import type { EventId } from '../../../domain/shared/ids'
import type { EventBus } from '../../ports/eventBus'
import type { InvalidateBook } from '../book/invalidateAlbumBook'
import type { InvalidateExport } from '../exports/invalidateAlbumExport'

/**
 * Erasing a reply that holds a note to the guestbook (spec 30, lot 4) takes a guestbook message out of
 * the evening: the repository deletes it with the reply, in one write, but **what prints the guestbook
 * must hear of it**, like any removal of a message (`deleteGuestbookEntry`):
 *
 * - **before** the erasure the photo book and the archive are retired (awaited: a book must never still
 *   hold what was erased; a failure leaves one needlessly stale, never one that holds a removed word);
 * - **after** it the book is retired again (a book requested between the two snapshots the message, and
 *   the second call is what retires it) and the guestbook's own signal tells the host's console.
 *
 * Every path that deletes replies asks this (`deleteOwnRsvp`, `hostDeleteRsvp`, the retention sweep); a
 * guard test reads the use cases and fails on one that deletes replies and does not.
 */

export interface NoteErasureDeps {
  readonly bus: Pick<EventBus, 'publish'>
  /** Retires the photo book that prints the guestbook; optional so a tool with no book can omit it. */
  readonly invalidateBook?: InvalidateBook
  /** Retires the archive that holds the guestbook; the same. */
  readonly invalidateExport?: InvalidateExport
}

/** Before the erasure of replies that hold notes, for each event they are in. */
export const beforeNotesErased = async (
  { invalidateBook, invalidateExport }: NoteErasureDeps,
  eventId: EventId,
): Promise<void> => {
  await invalidateExport?.(eventId, 'guestbookChanged')
  await invalidateBook?.(eventId, 'messageRemoved')
}

/** After it. */
export const afterNotesErased = async (
  { bus, invalidateBook }: NoteErasureDeps,
  eventId: EventId,
): Promise<void> => {
  await invalidateBook?.(eventId, 'messageRemoved')
  bus.publish({ type: 'guestbook.changed', eventId })
}
