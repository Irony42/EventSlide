import { requestBook, type AlbumBook, type BookOptions } from '../../../domain/book/albumBook'
import { isActive } from '../../../domain/book/albumBookStatus'
import {
  bookRetryAfterSeconds,
  bookWindowStart,
  checkBookDailyLimit,
} from '../../../domain/book/bookCaps'
import type { BookLayout } from '../../../domain/book/bookLayout'
import { parseBookSubtitle, parseBookTitle } from '../../../domain/book/bookTitle'
import type { EventLanguage } from '../../../domain/events/eventLanguage'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AlbumBookRepository } from '../../ports/albumBookRepository'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { PhotoRepository } from '../../ports/photoRepository'
import { clientContextOf } from '../clients/clientContextOf'
import { requireWritable } from '../shared/eventRole'

/**
 * The host asks for the photo book of an event (spec 04). A row is written `queued` and the
 * worker is woken; nothing is rendered here.
 *
 * What is refused, in this order, each with its own answer: an event the caller may not write
 * to (taken down, client suspended), the function switched off for the box (`BOOK_ENABLED`) or
 * for the client (`booksAllowed`), a book already queued or running, a title that is not one,
 * an album with nothing published (`book.empty`), and the third book of the day for an event
 * (`book.dailyLimitReached`, counted in `album_book_requests` so deleting the book cannot reset
 * it). A book too large for the ceilings is decided by the worker, which reads the album: it
 * ends `failed` with `tooLarge`, because the count here includes videos the book leaves out.
 */

export interface RequestAlbumBookDeps {
  readonly events: EventRepository
  readonly clients: ClientRepository
  readonly photos: Pick<PhotoRepository, 'countsByStatus'>
  readonly books: AlbumBookRepository
  readonly bus: EventBus
  readonly clock: Clock
  readonly policy: { readonly enabled: boolean; readonly maxPerEventPerDay: number }
}

export interface RequestAlbumBookInput {
  readonly eventId: EventId
  readonly title: string
  readonly subtitle?: string | undefined
  readonly language?: EventLanguage | undefined
  readonly layout: BookLayout
  readonly showAuthors: boolean
  readonly showCaptions: boolean
}

export type RequestAlbumBook = (
  input: RequestAlbumBookInput,
) => Promise<Result<AlbumBook, DomainError>>

export const makeRequestAlbumBook =
  ({
    events,
    clients,
    photos,
    books,
    bus,
    clock,
    policy,
  }: RequestAlbumBookDeps): RequestAlbumBook =>
  async (input) => {
    const event = await events.findById(input.eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))
    const writable = requireWritable(event)
    if (!writable.ok) return writable

    if (!policy.enabled) return err(DomainError.unexpected('book.unavailable'))
    const context = await clientContextOf(clients, event)
    if (context !== null && !context.ceilings.booksAllowed) {
      return err(DomainError.forbidden('book.notAllowed'))
    }

    const existing = await books.find(input.eventId)
    if (existing !== null && isActive(existing.status)) {
      return err(DomainError.conflict('book.alreadyRunning'))
    }

    const title = parseBookTitle(input.title)
    if (!title.ok) return title
    const subtitle = parseBookSubtitle(input.subtitle)
    if (!subtitle.ok) return subtitle

    // Only the empty case here: `published` also counts videos, which the book leaves out, so
    // the ceiling is judged by the worker on what it will really print.
    const counts = await photos.countsByStatus(input.eventId)
    if (counts.published === 0) return err(DomainError.conflict('book.empty'))

    const now = clock.now()
    const since = bookWindowStart(now)
    const requested = await books.countRequestsSince(input.eventId, since)
    const oldest = requested === 0 ? null : await books.firstRequestSince(input.eventId, since)
    const limit = checkBookDailyLimit(
      requested,
      policy.maxPerEventPerDay,
      oldest === null ? 1 : bookRetryAfterSeconds(oldest, now),
    )
    if (!limit.ok) return limit

    const options: BookOptions = {
      title: title.value,
      subtitle: subtitle.value,
      language: input.language ?? event.settings.wallLanguage,
      layout: input.layout,
      showAuthors: input.showAuthors,
      showCaptions: input.showCaptions,
    }
    const book = requestBook(input.eventId, options, now)
    await books.saveRequest(book)

    // After the row says it is queued: a subscriber must never learn of work that cannot be done
    // yet. This is what wakes the worker.
    bus.publish({ type: 'book.changed', eventId: input.eventId })
    return ok(book)
  }
