import type { AlbumBook } from '../../../domain/book/albumBook'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AlbumBookRepository } from '../../ports/albumBookRepository'
import type { EventRepository } from '../../ports/eventRepository'
import { requireReadable } from '../shared/eventRole'

/**
 * The state of the event's book for the host's screen: the row, or `null` when none was ever
 * requested. Reads one row and writes nothing; a suspended client is told so, like every read
 * of its event.
 */

export interface GetAlbumBookDeps {
  readonly events: EventRepository
  readonly books: Pick<AlbumBookRepository, 'find'>
}

export type GetAlbumBook = (input: {
  readonly eventId: EventId
}) => Promise<Result<AlbumBook | null, DomainError>>

export const makeGetAlbumBook =
  ({ events, books }: GetAlbumBookDeps): GetAlbumBook =>
  async ({ eventId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))
    const readable = requireReadable(event)
    if (!readable.ok) return readable
    return ok(await books.find(eventId))
  }
