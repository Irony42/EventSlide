import type { OutgoingMail } from '../../domain/mail/outgoingMail'
import { DomainError } from '../../domain/shared/errors'
import type { Result } from '../../domain/shared/result'

export type { OutgoingMail }

/**
 * Sending one e-mail (roadmap §10.3, G2-07 / P3-08). Optional by design.
 *
 * **A self-hosted box in a photographer's office usually has no SMTP credentials**, and a
 * product that silently requires them is a product that does not install. So this port is
 * built around the absence of a mail server rather than around its presence: with nothing
 * configured the composition root wires `NullMailer`, `canDeliver` is `false`, and the
 * caller's job is to **show the link for the operator to copy** into whatever they already
 * use to talk to their client. SMTP is the convenience, never the mechanism.
 *
 * What a caller may rely on:
 *
 * - **It never throws.** Every failure, including a socket that dies mid-conversation and
 *   an adapter bug, comes back as an `Err`. A use case that has already stored an
 *   invitation must not lose the whole request to a relay that was down.
 * - **`ok` means the relay accepted the message, not that anyone read it.** SMTP gives no
 *   better answer. A bounce arrives later, at the sender address, and nothing here sees it.
 * - **It is bounded in time.** An unreachable relay answers `mail.transient` after a few
 *   seconds, not after the operating system's TCP timeout, because a person is waiting on
 *   the request that asked.
 * - **It does not retry, queue or deduplicate.** Whether to try again, and whether to fall
 *   back to a link, is the caller's decision. A mailer that retried behind its caller's
 *   back could send a password reset twice.
 * - **It logs no address beyond its domain, and never a subject, a body or a link.** A
 *   password-reset link is a credential; one line in a log shipper would make it a leaked
 *   one. docs/SECURITY.md §9 states the rule and `smtpMailer.test.ts` plants a canary.
 *
 * What a caller must supply: a message already checked by `checkOutgoingMail`'s rules.
 * Every implementation applies them again, because the port is the last place that can
 * stop a recipient that is really a list or a subject that is really a header.
 */
export interface Mailer {
  /**
   * Whether this mailer can actually deliver. `false` is the answer of `NullMailer` and
   * means "do not wait for a mail to arrive; show the link".
   *
   * Constant for the life of the process and answered from a boolean, so it is as cheap as
   * asking and can be read when a page is rendered — the "send by e-mail" button shows or
   * hides on it.
   */
  readonly canDeliver: boolean

  /**
   * Hand one message to the relay.
   *
   * Fails with:
   *
   * - `mail.recipientInvalid`, `mail.subjectInvalid`, `mail.bodyInvalid` (kind `invalid`):
   *   the message breaks a rule of `checkOutgoingMail`. Nothing was sent.
   * - {@link MailFailureReason} codes, kind `unexpected` (an unavailable dependency):
   *   `mail.notConfigured`, `mail.rejected` and `mail.transient`.
   */
  send(mail: OutgoingMail): Promise<Result<void, DomainError>>
}

/**
 * Why a message that passed validation was not sent.
 *
 * - `notConfigured`: there is no relay. Permanent until an operator sets one; the caller
 *   shows a link.
 * - `rejected`: **do not retry**. The relay, or the address, was refused for good — a
 *   mailbox that does not exist (5xx), credentials that are wrong, a policy the relay
 *   enforces. The same message will fail the same way.
 * - `transient`: **retrying may help**. A timeout, a refused connection, a 4xx reply, a
 *   dropped socket. Also the answer for anything unclassified, because "try again later" is
 *   the safer thing to tell a caller than "never".
 */
export type MailFailureReason = 'notConfigured' | 'rejected' | 'transient'

/**
 * The error a mailer returns for {@link MailFailureReason}. Carries no details: what went
 * wrong on the wire is logged, with the address and the relay's own wording left out, and
 * never handed to a caller that may put it on a page.
 */
export const mailFailure = (reason: MailFailureReason): DomainError =>
  DomainError.unexpected(`mail.${reason}`)
