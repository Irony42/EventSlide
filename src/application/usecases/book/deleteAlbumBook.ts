import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AlbumBookRepository } from '../../ports/albumBookRepository'
import type { BookFileStore } from '../../ports/bookFileStore'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import { requireWritable } from '../shared/eventRole'

/**
 * The host throws their book away: the row (a render in flight finds it gone and stops) and the
 * file. Idempotent. The daily ceiling is not reset by it (requests are counted apart).
 */

export interface DeleteAlbumBookDeps {
  readonly events: EventRepository
  readonly books: Pick<AlbumBookRepository, 'delete'>
  readonly bookFiles: Pick<BookFileStore, 'delete'>
  readonly bus: EventBus
}

export type DeleteAlbumBook = (input: {
  readonly eventId: EventId
}) => Promise<Result<void, DomainError>>

export const makeDeleteAlbumBook =
  ({ events, books, bookFiles, bus }: DeleteAlbumBookDeps): DeleteAlbumBook =>
  async ({ eventId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))
    const writable = requireWritable(event)
    if (!writable.ok) return writable

    // The row first: a file with no row is collected by the sweep, while a row with no file
    // would be a `done` book that cannot be served.
    await books.delete(eventId)
    await bookFiles.delete(eventId)
    bus.publish({ type: 'book.changed', eventId })
    return ok(undefined)
  }
