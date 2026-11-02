import type { AlbumBook } from '../../domain/book/albumBook'
import type { BookStaleReason } from '../../domain/book/albumBookStatus'
import type { EventId } from '../../domain/shared/ids'

/**
 * The one photo book of each event, and the count of requests behind the daily ceiling.
 *
 * Every method is scoped by `eventId` except the box-wide reads the worker and the sweep need
 * (`claimNext`, `recoverRunning`, `listExpired`, `listDoneEventIds`, `doneBytes`), which return
 * ids and counts, never content.
 *
 * The moves that must be atomic (`claimNext`, `invalidate`) are the repository's job; **what
 * they decide is the domain's** (`startBook`, `invalidateBook`), so the SQLite adapter and the
 * fake answer the same way and the contract suite holds them to it.
 */
export interface AlbumBookRepository {
  find(eventId: EventId): Promise<AlbumBook | null>

  /**
   * A fresh request: replaces the event's row with this `queued` book **and records the
   * request** (what the daily ceiling counts), in one step.
   */
  saveRequest(book: AlbumBook): Promise<void>

  /** Writes the book as it now stands. Update-only: a book that was never requested is refused. */
  save(book: AlbumBook): Promise<void>

  /** The oldest `queued` book, **without** claiming it: what the worker looks at before it decides to wait. */
  findNextQueued(): Promise<AlbumBook | null>

  /** The oldest `queued` book, now `running` with `startedAt = now`; `null` when none is due. */
  claimNext(now: Date): Promise<AlbumBook | null>

  /**
   * A fact voids the book (`invalidateBook`). Returns the book as it is now, or `null` when
   * the event has none. Idempotent.
   */
  invalidate(eventId: EventId, reason: BookStaleReason, now: Date): Promise<AlbumBook | null>

  /** After a crash: every `running` book goes back to `queued`. Answers how many. */
  recoverRunning(): Promise<number>

  /** Requests made for this event at or after `since`, a deleted book's included. */
  countRequestsSince(eventId: EventId, since: Date): Promise<number>

  /** The earliest request of this event at or after `since`, or `null`: when a slot frees up. */
  firstRequestSince(eventId: EventId, since: Date): Promise<Date | null>

  /** Events whose book has an expiry at or before `now`. */
  listExpired(now: Date): Promise<readonly EventId[]>

  /** Events with a `done` book: the ones whose file is expected on the disk. */
  listDoneEventIds(): Promise<readonly EventId[]>

  /** Events with a queued or running book: their file, if any, must not be swept. */
  listActiveEventIds(): Promise<readonly EventId[]>

  /** Bytes held by finished books, box-wide: what `BOOK_MAX_TOTAL_BYTES` is judged against. */
  doneBytes(): Promise<number>

  /** Removes the event's book row. The request counter stays. Idempotent. */
  delete(eventId: EventId): Promise<void>
}
