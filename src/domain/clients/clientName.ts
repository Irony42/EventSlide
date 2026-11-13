import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import { characterCount, toSingleLine } from '../shared/plainText'

/**
 * A client's own name: the studio, the agency, the couple — whatever the operator typed
 * when the record was created (roadmap §10.2). Printed in the operator console (§10.4) and
 * on any mail a client receives (P3-08), so it is bounded and stripped of anything
 * invisible, the same way `EventName` is.
 *
 * The bounds are the catalogue's own `CHECK (length(name) BETWEEN 1 AND 200)` — see the
 * paid plan's "Schéma des clients" (P3-04) — so the two layers use the same numbers, and both
 * count code points (the domain through `characterCount`), so they agree on astral characters too.
 */

const MIN_LENGTH = 1
const MAX_LENGTH = 200

export class ClientName {
  private constructor(readonly value: string) {}

  static create(raw: unknown): Result<ClientName, DomainError> {
    if (typeof raw !== 'string') return err(DomainError.invalid('clientName.invalid'))

    const cleaned = toSingleLine(raw)

    if (characterCount(cleaned) < MIN_LENGTH) return err(DomainError.invalid('clientName.empty'))
    if (characterCount(cleaned) > MAX_LENGTH) {
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
