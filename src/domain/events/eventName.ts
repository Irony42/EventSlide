import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * The title a host types: "Camille & Sacha".
 *
 * It is one line of text on the projected wall header, on the printed join card and in
 * the admin list, so it is bounded and stripped of anything invisible. 80 characters is
 * what stays legible across a 1080p header from the back of a room; two is the shortest
 * thing a host can tell apart in a dashboard listing several events.
 *
 * The sanitisation mirrors photos/caption.ts and is duplicated rather than shared: a
 * title and a caption answer to different surfaces with different limits, and folding
 * them into one "clean some text" helper would hide which rule the host actually hit.
 */

const MIN_LENGTH = 2
const MAX_LENGTH = 80

/** A title is one line: three pasted newlines must not push the wall header around. */
const LINE_BREAKS = /[\t\n\r\f\v]+/g

/**
 * Everything invisible, by Unicode general category rather than a hand-listed range —
 * photos/caption.ts documents what each category covers. `Cf` is the one that earns its
 * place here: `U+202E` alone renders the rest of the title right-to-left on the wall,
 * and the zero-width joiners pad a name past its visible length.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/gu

/**
 * At least one letter or digit, in any script.
 *
 * A title of pure punctuation ("***") is not a title, and it is exactly the input for
 * which `Slug.fromName` yields an empty string — so without this rule the host is told
 * their *slug* is too short, which points at a field they never filled in.
 */
const HAS_ALPHANUMERIC = /[\p{L}\p{N}]/u

export class EventName {
  private constructor(readonly value: string) {}

  static create(raw: unknown): Result<EventName, DomainError> {
    if (typeof raw !== 'string') return err(DomainError.invalid('eventName.invalid'))

    const cleaned = raw
      .replace(LINE_BREAKS, ' ')
      .replace(INVISIBLE, '')
      .replace(/\s{2,}/gu, ' ')
      .trim()

    if (cleaned.length === 0) return err(DomainError.invalid('eventName.empty'))
    if (cleaned.length < MIN_LENGTH) {
      return err(DomainError.invalid('eventName.tooShort', { min: MIN_LENGTH }))
    }
    if (cleaned.length > MAX_LENGTH) {
      return err(DomainError.invalid('eventName.tooLong', { max: MAX_LENGTH }))
    }
    if (!HAS_ALPHANUMERIC.test(cleaned)) {
      return err(DomainError.invalid('eventName.malformed'))
    }
    return ok(new EventName(cleaned))
  }

  static readonly minLength = MIN_LENGTH
  static readonly maxLength = MAX_LENGTH

  equals(other: EventName): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
