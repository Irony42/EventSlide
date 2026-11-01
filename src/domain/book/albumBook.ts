import type { EventLanguage } from '../events/eventLanguage'
import { DomainError } from '../shared/errors'
import type { EventId } from '../shared/ids'
import { err, ok, type Result } from '../shared/result'
import {
  canTransition,
  type AlbumBookStatus,
  type BookFailureCode,
  type BookStaleReason,
} from './albumBookStatus'
import type { BookLayout } from './bookLayout'

/** What the host chose in the dialog. The title and subtitle are the host's text, not a guest's. */
export interface BookOptions {
  readonly title: string
  readonly subtitle: string
  readonly language: EventLanguage
  readonly layout: BookLayout
  readonly showAuthors: boolean
  readonly showCaptions: boolean
}

/**
 * The one book of an event. Plain data: every move is a pure function below, which the
 * SQLite adapter and the in-memory fake both mirror (the contract suite holds them to it).
 *
 * No guest text is stored: captions and first names are read again at render time.
 */
export interface AlbumBook {
  readonly eventId: EventId
  readonly status: AlbumBookStatus
  readonly options: BookOptions
  readonly requestedAt: Date
  /** The instant the book is frozen at: only photographs created up to it are in. */
  readonly snapshotAt: Date
  /** The latest fact that makes the book void; compared with `startedAt` when a render ends. */
  readonly invalidatedAt: Date | null
  readonly startedAt: Date | null
  readonly doneAt: Date | null
  readonly photoCount: number | null
  readonly skippedCount: number | null
  readonly pageCount: number | null
  readonly byteSize: number | null
  readonly expiresAt: Date | null
  readonly failureCode: BookFailureCode | null
  readonly staleReason: BookStaleReason | null
}

const illegal = (from: AlbumBookStatus, to: AlbumBookStatus): DomainError =>
  DomainError.conflict('book.illegalTransition', { from, to })

/** A fresh request. It replaces whatever the row held: a rebuild starts from nothing. */
export const requestBook = (eventId: EventId, options: BookOptions, now: Date): AlbumBook => ({
  eventId,
  status: 'queued',
  options,
  requestedAt: now,
  snapshotAt: now,
  invalidatedAt: null,
  startedAt: null,
  doneAt: null,
  photoCount: null,
  skippedCount: null,
  pageCount: null,
  byteSize: null,
  expiresAt: null,
  failureCode: null,
  staleReason: null,
})

export const startBook = (book: AlbumBook, now: Date): Result<AlbumBook, DomainError> =>
  canTransition(book.status, 'running')
    ? ok({ ...book, status: 'running', startedAt: now })
    : err(illegal(book.status, 'running'))

export interface BookResult {
  readonly photoCount: number
  readonly skippedCount: number
  readonly pageCount: number
  readonly byteSize: number
  readonly expiresAt: Date
}

/**
 * A render ended. A fact that voided the book **after the render started** wins over the
 * file just produced: the book is `stale`, never `done`, and the caller deletes the file.
 */
export const finishBook = (
  book: AlbumBook,
  result: BookResult,
  now: Date,
): Result<AlbumBook, DomainError> => {
  const voided =
    book.invalidatedAt !== null &&
    book.startedAt !== null &&
    book.invalidatedAt.getTime() >= book.startedAt.getTime()
  const to: AlbumBookStatus = voided ? 'stale' : 'done'
  if (!canTransition(book.status, to)) return err(illegal(book.status, to))
  return ok(
    voided
      ? { ...book, status: 'stale', staleReason: staleReasonOf(book) }
      : { ...book, status: 'done', doneAt: now, ...result },
  )
}

/** The reason recorded while the render ran is not kept apart; `photoRemoved` is the safe one. */
const staleReasonOf = (book: AlbumBook): BookStaleReason => book.staleReason ?? 'photoRemoved'

export const failBook = (book: AlbumBook, code: BookFailureCode): Result<AlbumBook, DomainError> =>
  canTransition(book.status, 'failed')
    ? ok({ ...book, status: 'failed', failureCode: code })
    : err(illegal(book.status, 'failed'))

/** After a crash: a book that was rendering goes back in the queue. */
export const recoverBook = (book: AlbumBook): Result<AlbumBook, DomainError> =>
  book.status === 'running'
    ? ok({ ...book, status: 'queued', startedAt: null })
    : err(illegal(book.status, 'queued'))

/**
 * A fact voids the book. Idempotent: a book already `stale`, `failed` or not yet started
 * only records the instant; `done` becomes `stale` (the caller deletes the file);
 * `queued` and `running` only record the instant, and the worker decides at the end.
 */
export const invalidateBook = (book: AlbumBook, reason: BookStaleReason, now: Date): AlbumBook => {
  if (book.status === 'done') {
    return { ...book, status: 'stale', invalidatedAt: now, staleReason: reason }
  }
  if (book.status === 'queued' || book.status === 'running') {
    return { ...book, invalidatedAt: now, staleReason: reason }
  }
  return book
}
