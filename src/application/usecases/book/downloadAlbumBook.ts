import { hasFile } from '../../../domain/book/albumBookStatus'
import { isBookExpired } from '../../../domain/book/bookExpiry'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AlbumBookRepository } from '../../ports/albumBookRepository'
import type { BookFileStore } from '../../ports/bookFileStore'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { ByteRange } from '../../ports/mediaStore'
import { requireReadable } from '../shared/eventRole'

/**
 * The finished book, as a stream with its size. One answer for every reason there is nothing to
 * give (no book, not `done`, expired, file gone, a draft): `book.notFound`. A suspended client is
 * told so and its file is kept; an event taken down is `event.notFound`.
 *
 * `open` takes the byte range of a `Range` request, so a phone that loses its signal resumes.
 * A `done` row whose file is missing is not served; the sweep turns it `stale`.
 */

export interface AlbumBookFile {
  readonly byteSize: number
  readonly open: (range?: ByteRange) => Promise<AsyncIterable<Uint8Array>>
}

export interface DownloadAlbumBookDeps {
  readonly events: EventRepository
  readonly books: Pick<AlbumBookRepository, 'find'>
  readonly bookFiles: Pick<BookFileStore, 'stat' | 'openRead'>
  readonly clock: Clock
}

export type DownloadAlbumBook = (input: {
  readonly eventId: EventId
}) => Promise<Result<AlbumBookFile, DomainError>>

const notFound = (): Result<never, DomainError> => err(DomainError.notFound('book.notFound'))

export const makeDownloadAlbumBook =
  ({ events, books, bookFiles, clock }: DownloadAlbumBookDeps): DownloadAlbumBook =>
  async ({ eventId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))
    const readable = requireReadable(event)
    if (!readable.ok) return readable

    const book = await books.find(eventId)
    if (book === null || !hasFile(book.status)) return notFound()
    if (book.expiresAt === null || isBookExpired(book.expiresAt, clock.now())) return notFound()

    const stored = await bookFiles.stat(eventId)
    if (stored === null) return notFound()

    return ok({
      byteSize: stored.size,
      open: async (range) => {
        const stream = await bookFiles.openRead(eventId, range)
        if (stream === null) throw new Error('the book file disappeared while it was opened')
        return stream
      },
    })
  }
