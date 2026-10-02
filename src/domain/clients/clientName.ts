import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * A client's own name: the studio, the agency, the couple — whatever the operator typed
 * when the record was created (roadmap §10.2). Printed in the operator console (§10.4) and
 * on any mail a client receives (P3-08), so it is bounded and stripped of anything
 * invisible, the same way `EventName` is.
 *
 * The bounds are the catalogue's own `CHECK (length(name) BETWEEN 1 AND 200)` — see the
 * paid plan's "Schéma des clients" (P3-04) — so the two layers use the same numbers. They
 * count differently, which is why this is not a claim that they agree on every string:
 * SQLite's `length()` counts code points and this counts UTF-16 units, so the domain is the
 * stricter of the two for a name of astral characters.
 */

const MIN_LENGTH = 1
const MAX_LENGTH = 200

const LINE_BREAKS = /[\t\n\r\f\v]+/g

/** Same categories as `EventName`: control characters, formatting marks, private use. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/gu

export class ClientName {
  private constructor(readonly value: string) {}

  static create(raw: unknown): Result<ClientName, DomainError> {
    if (typeof raw !== 'string') return err(DomainError.invalid('clientName.invalid'))

    const cleaned = raw
      .replace(LINE_BREAKS, ' ')
      .replace(INVISIBLE, '')
      .replace(/\s{2,}/gu, ' ')
      .trim()

    if (cleaned.length < MIN_LENGTH) return err(DomainError.invalid('clientName.empty'))
    if (cleaned.length > MAX_LENGTH) {
      return err(DomainError.invalid('clientName.tooLong', { max: MAX_LENGTH }))
    }
    return ok(new ClientName(cleaned))
  }

  static readonly minLength = MIN_LENGTH
  static readonly maxLength = MAX_LENGTH

  equals(other: ClientName): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
