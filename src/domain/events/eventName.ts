import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import { toSingleLine } from '../shared/plainText'

/**
 * The title a host types: "Camille & Sacha".
 *
 * It is one line of text on the projected wall header, on the printed join card and in
 * the admin list, so it is bounded and stripped of anything invisible. 80 characters is
 * what stays legible across a 1080p header from the back of a room; two is the shortest
 * thing a host can tell apart in a dashboard listing several events.
 *
 * The sanitisation is `toSingleLine`, shared with every other typed line of text: the
 * pipeline (and its `INVISIBLE` class) is one rule, and a second copy fails silently. What
 * stays here is this name's own: its length bounds and its need for a letter or digit.
 */

const MIN_LENGTH = 2
const MAX_LENGTH = 80

/**
 * At least one letter or digit, in any script.
 *
 * A title of pure punctuation ("***") is not a title, and it is exactly the input for
 * which `Slug.fromName` yields an empty string — so without this rule the host is told
 * their *slug* is too short, which points at a field they never filled in.
 */
const HAS_ALPHANUMERIC = /[\p{L}\p{N}]/u

/**
 * A name as the operator's lookup compares it: blanks trimmed, accents dropped, case folded. SQLite's
 * `lower()` only folds ASCII, so the comparison is made on this on both sides, in the adapter and in
 * the fake, and an event called "Fête de Noël" is found from "FETE DE NOEL" (launch review S5).
 */
export const foldName = (raw: string): string =>
  raw.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export class EventName {
  private constructor(readonly value: string) {}

  static create(raw: unknown): Result<EventName, DomainError> {
    if (typeof raw !== 'string') return err(DomainError.invalid('eventName.invalid'))

    const cleaned = toSingleLine(raw)

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
