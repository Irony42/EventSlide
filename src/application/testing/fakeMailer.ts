import { checkOutgoingMail } from '../../domain/mail/outgoingMail'
import { err, ok, type Result } from '../../domain/shared/result'
import type { DomainError } from '../../domain/shared/errors'
import {
  mailFailure,
  type MailFailureReason,
  type Mailer,
  type OutgoingMail,
} from '../ports/mailer'

/** What reached the far side, as plain strings so an assertion reads without unwrapping. */
export interface SentMail {
  readonly to: string
  readonly subject: string
  readonly text: string
  /** `null` when the message carried no HTML alternative. */
  readonly html: string | null
}

/**
 * A `Mailer` a test drives without a mail server: it records what it was asked to send and
 * can be told to fail the next send.
 *
 * It runs `checkOutgoingMail` first, exactly as every real adapter does, so a use-case test
 * cannot pass with a recipient or a subject the production mailer would refuse. That is the
 * drift the shared contract suite (`contracts/mailerContract.ts`) exists to catch, and it
 * is run against this class and against the SMTP adapter alike.
 *
 * `canDeliver` is `true`: a test that is about the **absence** of a mail server uses the real
 * `nullMailer`, which has no state to fake.
 */
export class FakeMailer implements Mailer {
  readonly canDeliver = true
  readonly sent: SentMail[] = []
  private readonly pendingFailures: MailFailureReason[] = []

  /**
   * Makes the next send fail with this reason, after validation and before anything is
   * recorded. Queued: three calls fail three sends, in order, and then sending works again.
   */
  failNextWith(reason: MailFailureReason): this {
    this.pendingFailures.push(reason)
    return this
  }

  async send(mail: OutgoingMail): Promise<Result<void, DomainError>> {
    const checked = checkOutgoingMail(mail)
    if (!checked.ok) return checked

    const failure = this.pendingFailures.shift()
    if (failure !== undefined) return err(mailFailure(failure))

    this.sent.push({
      to: mail.to.value,
      subject: mail.subject,
      text: mail.text,
      html: mail.html ?? null,
    })
    return ok(undefined)
  }
}
