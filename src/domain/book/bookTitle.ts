import { DomainError } from '../shared/errors'
import { toSingleLine } from '../shared/plainText'
import { err, ok, type Result } from '../shared/result'

/** The host's own words on the cover. Plain text, one line, never translated or corrected. */
export const BOOK_TITLE_MAX = 80
export const BOOK_SUBTITLE_MAX = 80

export const parseBookTitle = (raw: unknown): Result<string, DomainError> => {
  if (typeof raw !== 'string') return err(DomainError.invalid('book.titleInvalid'))
  const cleaned = toSingleLine(raw)
  if (cleaned.length === 0) return err(DomainError.invalid('book.titleEmpty'))
  if (cleaned.length > BOOK_TITLE_MAX) {
    return err(DomainError.invalid('book.titleTooLong', { max: BOOK_TITLE_MAX }))
  }
  return ok(cleaned)
}

/** A blank subtitle is no subtitle: the empty string, which an untouched field sends. */
export const parseBookSubtitle = (raw: unknown): Result<string, DomainError> => {
  if (raw === undefined || raw === null) return ok('')
  if (typeof raw !== 'string') return err(DomainError.invalid('book.subtitleInvalid'))
  const cleaned = toSingleLine(raw)
  if (cleaned.length > BOOK_SUBTITLE_MAX) {
    return err(DomainError.invalid('book.subtitleTooLong', { max: BOOK_SUBTITLE_MAX }))
  }
  return ok(cleaned)
}
