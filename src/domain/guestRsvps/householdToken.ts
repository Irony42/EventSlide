import { DomainError } from '../shared/errors'
import { JoinCode, normaliseJoinCode } from '../shared/joinCode'
import { err, ok, type Result } from '../shared/result'

/**
 * The secret in a household's personal link: `/i/<invitation>#f=7QX0M4TZ2KD9WB3H` (spec 30, lot 3).
 *
 * Built like the invitation's own token (`GuestInviteToken`): 16 characters of Crockford's base32
 * (80 bits), tolerant on input (case, separators and look-alike characters fold to the canonical
 * form, so a dictated link still resolves), and **stored in the clear** (ADR 0017): the host must
 * be able to show the link again, to copy it or print it on a card. It is a bearer credential: it
 * lets whoever holds it read, change and delete the household's one reply (and nothing else), it
 * travels in the URL's fragment and an `X-Household-Token` header, never in a path or a query,
 * and every lookup by it is bound to one event.
 *
 * Randomness is the caller's (`IdGenerator.bytes`): this module only maps bytes to characters.
 */

const LENGTH = 16

const INVALID = 'household.tokenInvalid'

export class HouseholdToken {
  private constructor(readonly value: string) {}

  /** Parses what a link, a header or a stored row carries. */
  static create(raw: unknown): Result<HouseholdToken, DomainError> {
    if (typeof raw !== 'string') return err(DomainError.invalid(INVALID))
    const candidate = normaliseJoinCode(raw)
    if (candidate.length !== LENGTH) return err(DomainError.invalid(INVALID))
    for (const character of candidate) {
      if (!JoinCode.alphabet.includes(character)) return err(DomainError.invalid(INVALID))
    }
    return ok(new HouseholdToken(candidate))
  }

  /** Maps exactly {@link HouseholdToken.length} random bytes to a token (`byte % 32` is uniform). */
  static fromBytes(bytes: Readonly<Uint8Array>): Result<HouseholdToken, DomainError> {
    if (bytes.length !== LENGTH) return err(DomainError.invalid(INVALID))
    let value = ''
    for (const byte of bytes) {
      value += JoinCode.alphabet.charAt(byte % JoinCode.alphabet.length)
    }
    return HouseholdToken.create(value)
  }

  static readonly length = LENGTH

  equals(other: HouseholdToken): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
