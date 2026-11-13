import { isSingleMailbox } from '../mail/outgoingMail'
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
 *
 * The one exception is what the mailer would **always** refuse: more than one mailbox, a quote, an
 * angle bracket, a parenthesis, a backslash. `isSingleMailbox` (`domain/mail/outgoingMail`) is the
 * only definition of that, so an address that is accepted here is one a message can be sent to: an
 * account registered as `a@b.example,c@d.example` could never be invited, reset or notified.
 */

const MAX_LENGTH = 254 // RFC 5321 path limit

export class EmailAddress {
  private constructor(readonly value: string) {}

  /**
   * The only way a **new** address enters: the shape a box may hold ({@link EmailAddress.fromStored})
   * and, on top of it, a single mailbox the mailer would accept (`isSingleMailbox`).
   */
  static create(raw: unknown): Result<EmailAddress, DomainError> {
    const stored = EmailAddress.fromStored(raw)
    if (!stored.ok) return stored
    if (!isSingleMailbox(stored.value.value)) return err(DomainError.invalid('email.malformed'))
    return stored
  }

  /**
   * An address as a box may **already hold it**: the rule `create` applied before it learnt the mail
   * rule (QUAL-09). Used where a stored row is read back, and where a typed address is only looked up
   * (sign-in), so an account registered as `a@b.example,c@d.example` still loads and still signs in
   * rather than failing every read that hydrates it. What was never storable (no `@`, whitespace, no
   * dot in the domain, too long) is still refused, so a genuinely corrupt row surfaces.
   *
   * Never a way for a new address to enter: that is `create`.
   */
  static fromStored(raw: unknown): Result<EmailAddress, DomainError> {
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

/**
 * The text every spelling of one address shares: what the lookup would find, so that
 * `Camille@Example.test ` and `camille@example.test` are one account to whatever keys on it.
 * What is not an address at all can never match an account and is keyed by its trimmed,
 * lower-cased text, so that nonsense is counted like anything else instead of being a way to
 * spend nothing. Used by the sign-in throttle and the trusted-device cookie (G3-04, G3-04b).
 */
export const normalisedAddress = (raw: string): string => {
  const parsed = EmailAddress.create(raw)
  return parsed.ok ? parsed.value.value : raw.trim().toLowerCase()
}
