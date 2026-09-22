import { DomainError } from '../shared/errors'
import { toSingleLine } from '../shared/plainText'
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
 * This is not HTML escaping — React escapes on render. The sanitising itself lives in
 * `shared/plainText.ts`, because a mission prompt (roadmap §2.1) is rendered in the same
 * room under the same rules and two copies of that character class would drift silently.
 */

const MAX_LENGTH = 140

export class Caption {
  private constructor(readonly value: string) {}

  static create(raw: unknown): Result<Caption, DomainError> {
    if (typeof raw !== 'string') return err(DomainError.invalid('caption.invalid'))

    const cleaned = toSingleLine(raw)

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
