import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * A host's or moderator's login identifier.
 *
 * 1.0 used a free-text `username`, which made "who is this account" unanswerable and
 * left no route to a password reset. An email address is the identifier a host already
 * has, and it is what a future magic-link sign-in would use.
 *
 * The validation here is deliberately shallow. There is no regex that correctly decides
 * whether an address is deliverable, and the strict ones reject valid addresses; the
 * real test is whether mail arrives. So this checks the shape that would break the
 * system (no `@`, whitespace, empty local or domain part) and normalises case, and
 * nothing more.
 */

const MAX_LENGTH = 254 // RFC 5321 path limit

export class EmailAddress {
  private constructor(readonly value: string) {}

  static create(raw: unknown): Result<EmailAddress, DomainError> {
    if (typeof raw !== 'string') return err(DomainError.invalid('email.invalid'))

    // The local part is technically case-sensitive; in practice no provider treats it
    // so, and storing mixed case would let two accounts differ only by capitalisation.
    const candidate = raw.trim().toLowerCase()

    if (candidate.length === 0) return err(DomainError.invalid('email.empty'))
    if (candidate.length > MAX_LENGTH) {
      return err(DomainError.invalid('email.tooLong', { max: MAX_LENGTH }))
    }
    if (/\s/u.test(candidate)) return err(DomainError.invalid('email.containsWhitespace'))

    const at = candidate.lastIndexOf('@')
    if (at <= 0 || at === candidate.length - 1) {
      return err(DomainError.invalid('email.malformed'))
    }
    const domain = candidate.slice(at + 1)
    if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) {
      return err(DomainError.invalid('email.malformed'))
    }

    return ok(new EmailAddress(candidate))
  }

  get domain(): string {
    return this.value.slice(this.value.lastIndexOf('@') + 1)
  }

  equals(other: EmailAddress): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }

  static readonly maxLength = MAX_LENGTH
}
