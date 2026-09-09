import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * The name a guest signs their photos with, shown under the photo on the wall.
 *
 * It is optional by design. The guest surface has one rule — zero friction — and
 * someone holding a drink in one hand must be able to get from the QR code to an
 * upload without being asked who they are. So an untouched name field is "anonymous"
 * (`createOptional`), not a validation error to bounce them on.
 *
 * Forty characters is a first name typed with a thumb, not a biography: the wall shows
 * it on one line, at a distance, beside a caption that has its own budget. Accents and
 * emoji survive, because "Léa" and "🎉" are both what guests actually type.
 */

const MIN_LENGTH = 1
const MAX_LENGTH = 40

/** A name is one line; whatever a paste dragged in is folded back to single spaces. */
const LINE_BREAKS = /[\t\n\r\f\v]+/g

/**
 * The invisible categories, addressed by Unicode property rather than by a hand-typed
 * range, exactly as `photos/caption.ts` does and for the same reasons: a single
 * bidirectional override (`Cf`) flips the rest of the projector line, and zero-width
 * characters let two guests hold names that look identical but are not.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/gu

const normalise = (raw: string): string =>
  raw
    .replace(LINE_BREAKS, ' ')
    .replace(INVISIBLE, '')
    .replace(/\s{2,}/gu, ' ')
    .trim()

export class DisplayName {
  private constructor(readonly value: string) {}

  static create(raw: string): Result<DisplayName, DomainError> {
    const cleaned = normalise(raw)

    if (cleaned.length < MIN_LENGTH) return err(DomainError.invalid('displayName.empty'))
    if (cleaned.length > MAX_LENGTH) {
      return err(DomainError.invalid('displayName.tooLong', { max: MAX_LENGTH }))
    }
    return ok(new DisplayName(cleaned))
  }

  /**
   * Parse the join form's name field. Absent, blank, or invisible-only all mean the
   * guest stayed anonymous — a field holding one zero-width character is a paste
   * accident, not a request the domain should refuse.
   */
  static createOptional(raw: string | null | undefined): Result<DisplayName | null, DomainError> {
    if (raw === null || raw === undefined) return ok(null)
    if (normalise(raw).length < MIN_LENGTH) return ok(null)
    return DisplayName.create(raw)
  }

  static readonly minLength = MIN_LENGTH
  static readonly maxLength = MAX_LENGTH

  equals(other: DisplayName): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
