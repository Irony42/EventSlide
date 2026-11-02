import type { BookStaleReason } from '../../../domain/book/albumBookStatus'
import type { EventId } from '../../../domain/shared/ids'
import type { AlbumBookRepository } from '../../ports/albumBookRepository'
import type { BookFileStore } from '../../ports/bookFileStore'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { Logger } from '../../ports/logger'

/**
 * Something the photo book holds left the evening, or changed: the book is no longer fit to give
 * (spec 04, privacy).
 *
 * Called, and awaited, by every path that takes a photograph out of the evening and by a caption
 * edit, **before** the bytes of the photograph go: a failure then leaves a book needlessly
 * stale, never a book that still holds what was removed. The bus is not the mechanism (it is
 * fire and forget); `bookInvalidation.guard.test.ts` fails the build when a new removing path
 * forgets the call.
 *
 * `done` becomes `stale` and the file is deleted at once; `queued` and `running` only record the
 * instant, and the worker rules when its render ends. A caption edit counts only for a book
 * that prints captions. Idempotent (`eraseGuestContribution` removes many photographs), and it
 * never throws: the removal the caller was asked for must not fail because a PDF could not be
 * tidied. A file that could not be deleted is collected by the sweep, and `downloadAlbumBook`
 * answers only for a `done` row, so it is not served meanwhile.
 */

export interface InvalidateAlbumBookDeps {
  readonly books: AlbumBookRepository
  readonly bookFiles: BookFileStore
  readonly bus: EventBus
  readonly clock: Clock
  readonly logger: Logger
}

export type InvalidateBook = (eventId: EventId, reason: BookStaleReason) => Promise<void>

export const makeInvalidateAlbumBook =
  ({ books, bookFiles, bus, clock, logger }: InvalidateAlbumBookDeps): InvalidateBook =>
  async (eventId, reason) => {
    try {
      const current = await books.find(eventId)
      if (current === null) return
      if (reason === 'captionChanged' && !current.options.showCaptions) return

      const after = await books.invalidate(eventId, reason, clock.now())
      if (after === null || after.status !== 'stale') return

      // Whenever the row is stale, so a delete that failed once is retried by the next call.
      await bookFiles.delete(eventId)
      if (current.status === 'done') bus.publish({ type: 'book.changed', eventId })
    } catch (cause) {
      logger.warn('could not retire a photo book; the sweep will finish it', {
        eventId,
        cause: String(cause),
      })
    }
  }
