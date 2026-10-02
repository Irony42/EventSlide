import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import type { EmailAddress } from '../users/emailAddress'

/**
 * One message to one person, as the application hands it to a mailer (roadmap §10.3,
 * G2-07 / P3-08).
 *
 * Deliberately small: a recipient, a subject, a plain-text body and, optionally, an HTML
 * alternative. Templates, languages and the links that go inside them arrive with the
 * use cases that send mail; none of that belongs in the shape of a message.
 *
 * `text` is required and `html` is not, because the plain-text part is the one that is
 * always readable — a mail client that blocks remote content, a screen reader, the
 * preview on a lock screen. HTML is a nicety laid over it, never a substitute.
 */
export interface OutgoingMail {
  readonly to: EmailAddress
  readonly subject: string
  readonly text: string
  readonly html?: string
}

/**
 * The longest subject a mailer will accept. A subject is one short line; anything longer is
 * a template that interpolated a body into it, and mail clients truncate it anyway.
 */
export const MAX_SUBJECT_LENGTH = 255

/**
 * Whether `address` names exactly one mailbox, and nothing that a mail system would read as
 * a second one or as a command.
 *
 * **This is not {@link EmailAddress}'s check, and it has to be stricter.** `EmailAddress`
 * decides whether a string is plausible as a login identifier, and says so: it is shallow on
 * purpose, rejecting whitespace and a missing `@` and little else. `a@b.example,c@d.example`
 * passes it — the last `@` splits the string into a "local part" holding the first address
 * and a comma. As a login that is merely a strange account; handed to a mail library as a
 * recipient it goes **somewhere nobody chose**. An address parser splits it into two
 * recipients, and an invitation to one person goes to both; `nodemailer`, given it as a
 * single address, instead rewrites it into one quoted mailbox (`"a@b.example,c"@d.example`),
 * which is a different one. The same goes for an angle bracket, a quote, a parenthesis, a
 * backslash or a NUL, which a parser reads as a display name, a comment, an escape or the
 * end of the string, and which `nodemailer` silently rewrites rather than refuses.
 *
 * So the mailer asks this of every recipient, in every implementation — the fake included,
 * so that a use-case test cannot pass with an address the real adapter would refuse. An
 * apostrophe stays legal in the local part (`o'brien@example.org` is a real address) and is
 * refused in the domain, where it never is one.
 */
const SINGLE_MAILBOX = /^[^\s<>",;()\\@\p{Cc}]+@[^\s<>"',;()\\@\p{Cc}]+$/u

export const isSingleMailbox = (address: string): boolean => SINGLE_MAILBOX.test(address)

/** Anything a header cannot carry on one line: CR, LF, NUL and the rest of the C0/C1 range. */
const CONTROL_CHARACTER = /\p{Cc}/u

/**
 * The rules a message must satisfy before any mailer looks at it. Every implementation
 * runs this first and returns its failure unchanged, which is what makes "the fake accepts
 * it" and "the real one sends it" the same claim.
 *
 * - **One recipient, one mailbox** ({@link isSingleMailbox}).
 * - **A one-line subject.** A carriage return or a line feed in a header value is how a
 *   caller-supplied string becomes `Bcc: someone@else.example`. A well-behaved SMTP client
 *   flattens it; this refuses it, because a subject with a line break in it is a bug in the
 *   caller and sending a quietly altered mail would hide it.
 * - **A non-empty body**, plain text always and HTML when it is given: a message that
 *   renders as nothing is a template that failed to fill.
 *
 * Fails with `invalid`, which is what it is: the message is wrong, as opposed to the relay
 * having refused it (`mail.rejected`, in the application port).
 */
export const checkOutgoingMail = (mail: OutgoingMail): Result<OutgoingMail, DomainError> => {
  if (!isSingleMailbox(mail.to.value)) return err(DomainError.invalid('mail.recipientInvalid'))

  const subject = mail.subject.trim()
  if (
    subject.length === 0 ||
    subject.length > MAX_SUBJECT_LENGTH ||
    CONTROL_CHARACTER.test(mail.subject)
  ) {
    return err(DomainError.invalid('mail.subjectInvalid'))
  }

  if (mail.text.trim().length === 0) return err(DomainError.invalid('mail.bodyInvalid'))
  if (mail.html !== undefined && mail.html.trim().length === 0) {
    return err(DomainError.invalid('mail.bodyInvalid'))
  }

  return ok(mail)
}
