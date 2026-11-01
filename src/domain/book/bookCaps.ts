import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * May a book of this many photographs be made?
 *
 * Zero is refused (`book.empty`, 409): a draft has no published photo and an empty cover is
 * not a book. The ceiling is **inclusive**: a book of exactly `maxPhotos` is allowed and one
 * more is `book.tooLarge`, which carries the ceiling so the host can be told what to cut.
 */
export const checkBookSize = (photoCount: number, maxPhotos: number): Result<void, DomainError> => {
  if (photoCount < 1) return err(DomainError.conflict('book.empty'))
  if (photoCount > maxPhotos) {
    return err(DomainError.quotaExceeded('book.tooLarge', { max: maxPhotos }))
  }
  return ok(undefined)
}

/**
 * The bytes the chosen renditions would add up to, judged **before** rendering so an
 * oversized book is refused at the start instead of abandoned at 90 % after the most
 * expensive minute of CPU of the event. Inclusive, like the photo ceiling.
 */
export const checkBookBytes = (totalBytes: number, maxBytes: number): Result<void, DomainError> =>
  totalBytes > maxBytes
    ? err(DomainError.quotaExceeded('book.tooLarge', { maxBytes }))
    : ok(undefined)

/** The rolling day over which an event's book requests are counted (decision of 01/11/2026). */
export const BOOK_WINDOW_MS = 24 * 60 * 60 * 1000

/** The start of the rolling day that ends at `now`. */
export const bookWindowStart = (now: Date): Date => new Date(now.getTime() - BOOK_WINDOW_MS)

/**
 * May another book be requested, given how many were requested in the window? Refuses **at**
 * the limit, not after it: three a day means the fourth is refused.
 */
export const checkBookDailyLimit = (
  requestsInWindow: number,
  maxPerDay: number,
): Result<void, DomainError> =>
  requestsInWindow >= maxPerDay
    ? err(DomainError.rateLimited('book.dailyLimitReached', { max: maxPerDay }))
    : ok(undefined)
