import { DomainError } from '../shared/errors'
import type { EventId } from '../shared/ids'
import { err, ok, type Result } from '../shared/result'
import {
  canTransition,
  type AlbumBookStatus,
  type BookFailureCode,
  type BookPrintSkipped,
  type BookStaleReason,
} from './albumBookStatus'
import type { BookOptionsV2 } from './bookOptionsV2'
import type { BookPlan } from './bookPlan'

/** What the host chose in the dialog (spec 26): the options of the v2 book, a 3.14 request converted. */
export type BookOptions = BookOptionsV2

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
  /** Photographs the plan kept (every one for a v1 book); photoCount is those that were drawn. */
  readonly selectedCount: number | null
  /** The printer version's two files together, null when there is none. */
  readonly printByteSize: number | null
  readonly printSkipped: BookPrintSkipped | null
  /** The plan the render follows: written when it starts, voided with the book. Ids and numbers only. */
  readonly plan: BookPlan | null
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
  selectedCount: null,
  printByteSize: null,
  printSkipped: null,
  plan: null,
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
  readonly selectedCount: number
  readonly printByteSize: number | null
  readonly printSkipped: BookPrintSkipped | null
  readonly expiresAt: Date
}

/** A fact that voided the book at or after the instant its render started. */
const isVoidedSinceStart = (book: AlbumBook): boolean =>
  book.invalidatedAt !== null &&
  book.startedAt !== null &&
  book.invalidatedAt.getTime() >= book.startedAt.getTime()

/**
 * A render ended. A fact that voided the book **after the render started** wins over the
 * file just produced: the book is `stale`, never `done`, and the caller deletes the file.
 */
export const finishBook = (
  book: AlbumBook,
  result: BookResult,
  now: Date,
): Result<AlbumBook, DomainError> => {
  const voided = isVoidedSinceStart(book)
  const to: AlbumBookStatus = voided ? 'stale' : 'done'
  if (!canTransition(book.status, to)) return err(illegal(book.status, to))
  return ok(
    voided
      ? { ...book, status: 'stale', staleReason: staleReasonOf(book), plan: null }
      : { ...book, status: 'done', doneAt: now, ...result },
  )
}

/**
 * What the final write of a render did: `done` / `stale` (a fact voided the book while it
 * rendered) / `failed` were recorded; `superseded`: the row was deleted or replaced by a new
 * request meanwhile, so nothing was written and the caller deletes the file it produced.
 */
export type BookFinish = 'done' | 'stale' | 'failed' | 'superseded'

/** What the final write did when it took `settled` as the row's new state. */
export const finishOf = (settled: AlbumBook): BookFinish =>
  settled.status === 'done' || settled.status === 'stale' || settled.status === 'failed'
    ? settled.status
    : 'superseded'

/** How a render ended: a file was produced, or it gave up with a closed code. */
export type BookVerdict =
  | { readonly kind: 'finished'; readonly result: BookResult }
  | { readonly kind: 'failed'; readonly code: BookFailureCode }

/** The move a verdict makes on the book as it stands, or the refusal when it is not `running`. */
export const settleBook = (
  book: AlbumBook,
  verdict: BookVerdict,
  now: Date,
): Result<AlbumBook, DomainError> =>
  verdict.kind === 'finished' ? finishBook(book, verdict.result, now) : failBook(book, verdict.code)

/** The reason recorded while the render ran is not kept apart; `photoRemoved` is the safe one. */
const staleReasonOf = (book: AlbumBook): BookStaleReason => book.staleReason ?? 'photoRemoved'

/**
 * The render writes its plan once, as it starts: only a running book takes one, so a plan can
 * never be attached to a book the host re-requested or deleted in the meantime, **nor to one a fact
 * has already voided** (the plan was composed from what that fact removed: the render is for nothing
 * and must not leave a plan behind).
 */
export const recordPlan = (book: AlbumBook, plan: BookPlan): Result<AlbumBook, DomainError> => {
  if (book.status !== 'running') return err(DomainError.conflict('book.notRunning'))
  if (isVoidedSinceStart(book)) return err(DomainError.conflict('book.voided'))
  return ok({ ...book, plan })
}

export const failBook = (book: AlbumBook, code: BookFailureCode): Result<AlbumBook, DomainError> =>
  canTransition(book.status, 'failed')
    ? ok({ ...book, status: 'failed', failureCode: code, plan: null })
    : err(illegal(book.status, 'failed'))

/**
 * A fact voids the book. Idempotent: a book already `stale`, `failed` or not yet started
 * only records the instant; `done` becomes `stale` (the caller deletes the file);
 * `queued` and `running` only record the instant, and the worker decides at the end.
 */
export const invalidateBook = (book: AlbumBook, reason: BookStaleReason, now: Date): AlbumBook => {
  if (book.status === 'done') {
    return { ...book, status: 'stale', invalidatedAt: now, staleReason: reason, plan: null }
  }
  if (book.status === 'queued' || book.status === 'running') {
    return { ...book, invalidatedAt: now, staleReason: reason, plan: null }
  }
  return book
}
