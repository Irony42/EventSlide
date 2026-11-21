import { DomainError } from '../shared/errors'
import { JoinCode, normaliseJoinCode } from '../shared/joinCode'
import { err, ok, type Result } from '../shared/result'

/**
 * The secret in a guest invitation's link: `/i/7QX0M4TZ2KD9WB3H` (spec 29).
 *
 * **Stored in the clear**, unlike the gallery's token (ADR 0016): the host must be able to show
 * the link again at any time (to reprint a card, to share it from another device), which a digest
 * cannot give back. It is a bearer credential of the same kind as the join code, and it is
 * treated as one: masked in the logs, never in a `Referer`, never indexed.
 *
 * 16 characters of Crockford's base32 (the join code's alphabet, so `I`/`L`/`O` are read as the
 * digits they look like): 80 bits, which no enumeration under the per-IP limit reaches, and short
 * enough for a QR code readable at 30 mm and a link that can be dictated. Randomness is the
 * caller's (`IdGenerator.bytes`); this module only maps bytes to characters.
 */

const LENGTH = 16

const INVALID = 'guestInvite.tokenInvalid'

export class GuestInviteToken {
  private constructor(readonly value: string) {}

  /**
   * Parses what a link or a stored row carries. Tolerant like a join code: case, separators and
   * the look-alike characters fold to the canonical form, so a dictated token still resolves.
   */
  static create(raw: unknown): Result<GuestInviteToken, DomainError> {
    if (typeof raw !== 'string') return err(DomainError.invalid(INVALID))
    const candidate = normaliseJoinCode(raw)
    if (candidate.length !== LENGTH) return err(DomainError.invalid(INVALID))
    for (const character of candidate) {
      if (!JoinCode.alphabet.includes(character)) return err(DomainError.invalid(INVALID))
    }
    return ok(new GuestInviteToken(candidate))
  }

  /**
   * Maps exactly {@link GuestInviteToken.length} random bytes to a token. `byte % 32` is uniform
   * (256 is a multiple of 32): no bias, no rejection sampling.
   */
  static fromBytes(bytes: Readonly<Uint8Array>): Result<GuestInviteToken, DomainError> {
    if (bytes.length !== LENGTH) return err(DomainError.invalid(INVALID))
    let value = ''
    for (const byte of bytes) {
      value += JoinCode.alphabet.charAt(byte % JoinCode.alphabet.length)
    }
    return GuestInviteToken.create(value)
  }

  static readonly length = LENGTH

  equals(other: GuestInviteToken): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
