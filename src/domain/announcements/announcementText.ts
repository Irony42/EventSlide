import { DomainError } from '../shared/errors'
import { characterCount, toSingleLine } from '../shared/plainText'
import { err, ok, type Result } from '../shared/result'

/**
 * One line the host writes and the whole room reads off the wall: "Gâteau à 22 h" (spec 21).
 *
 * It is **content**, not interface copy: the host types it in whatever language the evening is
 * held in, it is stored as typed and never translated, and React escapes it on render. It is
 * folded to a single line and stripped of control and invisible characters by
 * {@link toSingleLine}, the treatment a mission's prompt gets, for the same reason: it reaches a
 * projector in front of two hundred people.
 *
 * **Eighty characters**, against a mission's sixty. The card allows two visual lines at ten
 * metres; past that nobody reads it.
 */

const MAX_LENGTH = 80

export class AnnouncementText {
  private constructor(readonly value: string) {}

  /** Empty, too long, or not a string: one code, with the limit, because one form field shows it. */
  static create(raw: unknown): Result<AnnouncementText, DomainError> {
    const invalid = (): DomainError =>
      DomainError.invalid('announcement.textInvalid', { max: MAX_LENGTH })
    if (typeof raw !== 'string') return err(invalid())

    const cleaned = toSingleLine(raw)
    if (characterCount(cleaned) === 0) return err(invalid())
    if (characterCount(cleaned) > MAX_LENGTH) return err(invalid())
    return ok(new AnnouncementText(cleaned))
  }

  static readonly maxLength = MAX_LENGTH

  equals(other: AnnouncementText): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
