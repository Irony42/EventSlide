import { DomainError } from '../shared/errors'
import { toSingleLine } from '../shared/plainText'
import { err, ok, type Result } from '../shared/result'

/**
 * The name a person gives when they accept an invitation: what the host's "who has the
 * console" list prints beside their address, and what an operator sees of the account.
 *
 * Required at acceptance, unlike a guest's (`DisplayName`), because this is an account that
 * other people will read about in a list of names and addresses, and a list of bare
 * addresses is how a host cannot tell their cousin from a stranger. Eighty characters: a
 * full name with a middle one, not a signature block.
 *
 * Normalised on the way in rather than refused for it, by the same `toSingleLine` as a caption
 * and a mission prompt, so there is one copy of the set of characters that corrupt a line: a
 * paste drags in line breaks and zero-width characters, and a name that is "Léa" plus an
 * invisible character is "Léa" to everyone who reads it — except the one who wants two
 * accounts that look identical, or one bidirectional override that flips the rest of the
 * line. Accents and emoji survive.
 */

const MIN_LENGTH = 1
const MAX_LENGTH = 80

export class AccountName {
  private constructor(readonly value: string) {}

  static create(raw: string): Result<AccountName, DomainError> {
    const cleaned = toSingleLine(raw)

    if (cleaned.length < MIN_LENGTH) return err(DomainError.invalid('accountName.empty'))
    if (cleaned.length > MAX_LENGTH) {
      return err(DomainError.invalid('accountName.tooLong', { max: MAX_LENGTH }))
    }
    return ok(new AccountName(cleaned))
  }

  static readonly minLength = MIN_LENGTH
  static readonly maxLength = MAX_LENGTH

  equals(other: AccountName): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
