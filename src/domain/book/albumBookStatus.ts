/**
 * The life of one photo book (spec 04, "export PDF / livre photo").
 *
 * A machine of its own, as `ClipJobStatus` is, and for the same reason: a book that is
 * still rendering is machinery, not a moderation decision, so it never becomes a member of
 * `PHOTO_STATUSES`.
 *
 * ```
 *   queued ──claim──► running ──succeed──► done ──invalidate/expire──► stale
 *     ▲                  │  └──fail──► failed          │
 *     │                  └──invalidated while rendering──► stale
 *     └──recover / retry / rebuild───────────────────────────┘
 * ```
 *
 * `stale` is a book that **must not be served any more**: a photo it holds was removed (or a
 * caption changed) after it was asked for, or its file is gone. Its file is deleted; the
 * host rebuilds it. `done`, `stale` and `failed` all go back to `queued` when the host asks
 * again, and the row then describes the new request.
 */
export const ALBUM_BOOK_STATUSES = ['queued', 'running', 'done', 'failed', 'stale'] as const

export type AlbumBookStatus = (typeof ALBUM_BOOK_STATUSES)[number]

const ALLOWED_TRANSITIONS: Readonly<Record<AlbumBookStatus, readonly AlbumBookStatus[]>> = {
  queued: ['running'],
  // `queued` is the recovery after a crash; `stale` is a fact that arrived during the render.
  running: ['queued', 'done', 'failed', 'stale'],
  // `queued` is "rebuild the book", `stale` is "something it holds was removed".
  done: ['stale', 'queued'],
  failed: ['queued'],
  stale: ['queued'],
}

export const isAlbumBookStatus = (value: unknown): value is AlbumBookStatus =>
  typeof value === 'string' && (ALBUM_BOOK_STATUSES as readonly string[]).includes(value)

/** A no-op transition is refused: a second claim of a running book is two writers on one file. */
export const canTransition = (from: AlbumBookStatus, to: AlbumBookStatus): boolean =>
  ALLOWED_TRANSITIONS[from].includes(to)

/** Work is queued or under way: the host may not ask for another book now. */
export const isActive = (status: AlbumBookStatus): boolean =>
  status === 'queued' || status === 'running'

/** Only a finished, still valid book has a file to serve. */
export const hasFile = (status: AlbumBookStatus): boolean => status === 'done'

/** Why a render gave up. A closed list: never free text, never a path. */
export const BOOK_FAILURE_CODES = ['unavailable', 'tooLarge', 'empty', 'unexpected'] as const
export type BookFailureCode = (typeof BOOK_FAILURE_CODES)[number]

export const isBookFailureCode = (value: unknown): value is BookFailureCode =>
  typeof value === 'string' && (BOOK_FAILURE_CODES as readonly string[]).includes(value)

/**
 * Why a book stopped being valid. Neutral on purpose: it never says whether a guest, the host
 * or the operator acted, as the signals of a removal do not.
 */
export const BOOK_STALE_REASONS = ['photoRemoved', 'captionChanged', 'fileMissing'] as const
export type BookStaleReason = (typeof BOOK_STALE_REASONS)[number]

export const isBookStaleReason = (value: unknown): value is BookStaleReason =>
  typeof value === 'string' && (BOOK_STALE_REASONS as readonly string[]).includes(value)
