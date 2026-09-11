import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * A guest-authored caption, projected under the photo on the wall.
 *
 * It is untrusted text that will be rendered at `--text-xl` in front of the whole
 * room, so it is bounded and sanitised here. Length is capped at 140 characters
 * because that is roughly what stays legible at 3-10 metres on two lines; longer
 * captions get truncated by the layout anyway, and silently dropping half of what
 * someone wrote is worse than telling them.
 *
 * This is not HTML escaping — React escapes on render. It removes the characters that
 * corrupt a line of text regardless of escaping.
 */

const MAX_LENGTH = 140

/**
 * Whitespace a guest can actually type, folded to a single space. A caption is one
 * line: three pasted newlines must not push the photo credit off the projector.
 */
const LINE_BREAKS = /[\t\n\r\f\v]+/g

/**
 * Everything invisible, by Unicode general category rather than by a hand-listed
 * range:
 *
 * - `Cc` — C0/C1 control codes.
 * - `Cf` — format characters. This is the important one: it covers the bidirectional
 *   overrides and isolates (`U+202E` alone can render the rest of the caption
 *   right-to-left), the zero-width space and joiners used to pad a caption past its
 *   visible length, and the byte-order mark.
 * - `Cs`, `Co`, `Cn` — lone surrogates, private-use and unassigned code points, which
 *   render as replacement boxes on the wall.
 * - `Zl`, `Zp` — line and paragraph separators, which some clients send instead of a
 *   newline.
 *
 * Ordinary space separators (`Zs`, including a non-breaking space) survive here and
 * are collapsed by the whitespace pass instead, because JavaScript's `\s` covers them.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/gu

export class Caption {
  private constructor(readonly value: string) {}

  static create(raw: unknown): Result<Caption, DomainError> {
    if (typeof raw !== 'string') return err(DomainError.invalid('caption.invalid'))

    const cleaned = raw
      .replace(LINE_BREAKS, ' ')
      .replace(INVISIBLE, '')
      .replace(/\s{2,}/gu, ' ')
      .trim()

    if (cleaned.length === 0) return err(DomainError.invalid('caption.empty'))
    if (cleaned.length > MAX_LENGTH) {
      return err(DomainError.invalid('caption.tooLong', { max: MAX_LENGTH }))
    }
    return ok(new Caption(cleaned))
  }

  /**
   * Parse an optional caption: absent, blank or whitespace-only all mean "no caption",
   * which is what an untouched form field sends. Anything else must be valid.
   */
  static createOptional(raw: unknown): Result<Caption | null, DomainError> {
    if (raw === null || raw === undefined) return ok(null)
    if (typeof raw === 'string' && raw.trim() === '') return ok(null)
    return Caption.create(raw)
  }

  static readonly maxLength = MAX_LENGTH

  equals(other: Caption): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
