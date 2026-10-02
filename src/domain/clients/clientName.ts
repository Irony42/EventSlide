import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * A client's own name: the studio, the agency, the couple — whatever the operator typed
 * when the record was created (roadmap §10.2). Printed in the operator console (§10.4) and
 * on any mail a client receives (P3-08), so it is bounded and stripped of anything
 * invisible, the same way `EventName` is.
 *
 * The bound is the catalogue's own `CHECK (length(name) BETWEEN 1 AND 200)` — see the paid
 * plan's "Schéma des clients" (P3-04) — so the domain refuses nothing the database would
 * accept, and the database refuses nothing a hand-edited row could otherwise hold.
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
