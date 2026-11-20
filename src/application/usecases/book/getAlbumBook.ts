import type { AlbumBook } from '../../../domain/book/albumBook'
import { hasFile } from '../../../domain/book/albumBookStatus'
import { MAX_ENTRIES_PER_EVENT } from '../../../domain/guestbook/guestbookLimits'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AlbumBookRepository } from '../../ports/albumBookRepository'
import type { BookFileStore } from '../../ports/bookFileStore'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import type { PhotoRepository } from '../../ports/photoRepository'
import { requireReadable } from '../shared/eventRole'

/**
 * The state of the event's book for the host's screen: the row, or `null` when none was ever
 * requested, and what the form needs to offer its choices: the published photographs (clips left
 * out) and the published written messages of the album **now**, which are not what a book will
 * hold (a book is frozen at its own request). Reads and writes nothing; a suspended client is
 * told so, like every read of its event.
 */

export interface AlbumCounts {
  readonly photos: number
  readonly messages: number
}

export interface GetAlbumBookDeps {
  readonly events: EventRepository
  readonly books: Pick<AlbumBookRepository, 'find'>
  readonly photos: Pick<PhotoRepository, 'countPublishedPhotos'>
  readonly guestbook: Pick<GuestbookRepository, 'listWrittenByStatuses'>
  readonly bookFiles: Pick<BookFileStore, 'stat'>
}

export interface AlbumBookState {
  readonly book: AlbumBook | null
  readonly counts: AlbumCounts
  /** The sizes of the two printer files of a finished book that has them, else `null`. */
  readonly printFiles: { readonly interior: number; readonly cover: number } | null
}

export type GetAlbumBook = (input: {
  readonly eventId: EventId
}) => Promise<Result<AlbumBookState, DomainError>>

export const makeGetAlbumBook =
  ({ events, books, photos, guestbook, bookFiles }: GetAlbumBookDeps): GetAlbumBook =>
  async ({ eventId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))
    const readable = requireReadable(event)
    if (!readable.ok) return readable

    const published = await photos.countPublishedPhotos(eventId)

    const messages = await guestbook.listWrittenByStatuses(
      eventId,
      ['published'],
      MAX_ENTRIES_PER_EVENT,
    )
    const book = await books.find(eventId)
    let printFiles: AlbumBookState['printFiles'] = null
    if (book !== null && hasFile(book.status) && book.printByteSize !== null) {
      const interior = await bookFiles.stat(eventId, 'printInterior')
      const cover = await bookFiles.stat(eventId, 'printCover')
      if (interior !== null && cover !== null)
        printFiles = { interior: interior.size, cover: cover.size }
    }
    return ok({ book, counts: { photos: published, messages: messages.length }, printFiles })
  }
