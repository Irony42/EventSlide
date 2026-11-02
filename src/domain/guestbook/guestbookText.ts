import { DomainError } from '../shared/errors'
import { toMultiLine } from '../shared/plainText'
import { err, ok, type Result } from '../shared/result'

/**
 * A guest's message in the guestbook (spec 01): a short paragraph of plain text.
 *
 * Untrusted text that a host reads and that may be projected in front of a room, so it is
 * bounded and cleaned here, and **only** here. It is never HTML, never Markdown and never a link:
 * a URL stays text. This is not escaping - React escapes on render - it removes what corrupts a
 * line whatever the escaping is (`shared/plainText.ts` has the argument).
 *
 * Length is counted in **code points** after normalisation, not UTF-16 units, so an emoji is one
 * character and a limit never cuts one in half. At most eight line breaks, because a card on a
 * wall has a height.
 */

export const GUESTBOOK_TEXT_MAX_LENGTH = 500
export const GUESTBOOK_TEXT_MAX_LINES = 8

export class GuestbookText {
  private constructor(readonly value: string) {}

  static create(raw: unknown): Result<GuestbookText, DomainError> {
    if (typeof raw !== 'string') return err(DomainError.invalid('guestbook.invalid'))

    const cleaned = toMultiLine(raw)

    if (cleaned.length === 0) return err(DomainError.invalid('guestbook.empty'))
    if ([...cleaned].length > GUESTBOOK_TEXT_MAX_LENGTH) {
      return err(DomainError.invalid('guestbook.tooLong', { max: GUESTBOOK_TEXT_MAX_LENGTH }))
    }
    if (cleaned.split('\n').length - 1 > GUESTBOOK_TEXT_MAX_LINES) {
      return err(DomainError.invalid('guestbook.tooManyLines', { max: GUESTBOOK_TEXT_MAX_LINES }))
    }
    return ok(new GuestbookText(cleaned))
  }

  /** How many characters a reader sees, which is what the wall sizes its card from. */
  get length(): number {
    return [...this.value].length
  }

  equals(other: GuestbookText): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
