import type { AlbumBookRepository } from '../ports/albumBookRepository'
import { invalidateBook, startBook, type AlbumBook } from '../../domain/book/albumBook'
import { hasFile, isActive, type BookStaleReason } from '../../domain/book/albumBookStatus'
import type { EventId } from '../../domain/shared/ids'

/**
 * In-memory `AlbumBookRepository`. One row per event, a list of request instants, and the
 * same domain moves as the SQLite adapter, which the contract suite checks.
 */
export class FakeAlbumBookRepository implements AlbumBookRepository {
  private readonly books = new Map<EventId, AlbumBook>()
  private readonly requests: { readonly eventId: EventId; readonly at: Date }[] = []

  async find(eventId: EventId): Promise<AlbumBook | null> {
    return this.books.get(eventId) ?? null
  }

  async saveRequest(book: AlbumBook): Promise<void> {
    this.books.set(book.eventId, book)
    this.requests.push({ eventId: book.eventId, at: book.requestedAt })
  }

  async save(book: AlbumBook): Promise<void> {
    if (!this.books.has(book.eventId)) {
      throw new Error('AlbumBookRepository.save: no book was requested for this event')
    }
    this.books.set(book.eventId, book)
  }

  async claimNext(now: Date): Promise<AlbumBook | null> {
    const queued = [...this.books.values()]
      .filter((book) => book.status === 'queued')
      .sort((left, right) => left.requestedAt.getTime() - right.requestedAt.getTime())
    const next = queued[0]
    if (next === undefined) return null
    const started = startBook(next, now)
    if (!started.ok) return null
    this.books.set(next.eventId, started.value)
    return started.value
  }

  async invalidate(
    eventId: EventId,
    reason: BookStaleReason,
    now: Date,
  ): Promise<AlbumBook | null> {
    const book = this.books.get(eventId)
    if (book === undefined) return null
    const next = invalidateBook(book, reason, now)
    this.books.set(eventId, next)
    return next
  }

  async recoverRunning(): Promise<number> {
    let recovered = 0
    for (const [eventId, book] of this.books) {
      if (book.status !== 'running') continue
      this.books.set(eventId, { ...book, status: 'queued', startedAt: null })
      recovered += 1
    }
    return recovered
  }

  async countRequestsSince(eventId: EventId, since: Date): Promise<number> {
    return this.requests.filter(
      (request) => request.eventId === eventId && request.at.getTime() >= since.getTime(),
    ).length
  }

  async firstRequestSince(eventId: EventId, since: Date): Promise<Date | null> {
    const times = this.requests
      .filter((request) => request.eventId === eventId && request.at.getTime() >= since.getTime())
      .map((request) => request.at.getTime())
    return times.length === 0 ? null : new Date(Math.min(...times))
  }

  async listExpired(now: Date): Promise<readonly EventId[]> {
    return [...this.books.values()]
      .filter((book) => book.expiresAt !== null && book.expiresAt.getTime() <= now.getTime())
      .map((book) => book.eventId)
  }

  async listDoneEventIds(): Promise<readonly EventId[]> {
    return [...this.books.values()].filter((book) => hasFile(book.status)).map((b) => b.eventId)
  }

  async listActiveEventIds(): Promise<readonly EventId[]> {
    return [...this.books.values()].filter((book) => isActive(book.status)).map((b) => b.eventId)
  }

  async doneBytes(): Promise<number> {
    return [...this.books.values()]
      .filter((book) => hasFile(book.status))
      .reduce((sum, book) => sum + (book.byteSize ?? 0), 0)
  }

  async delete(eventId: EventId): Promise<void> {
    this.books.delete(eventId)
  }
}
