import { AuditEntry } from '../../../domain/audit/auditEntry'
import { signupRefusedMail } from '../../../domain/mail/signupMails'
import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EmailAddress } from '../../../domain/users/emailAddress'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { Logger } from '../../ports/logger'
import type { Mailer } from '../../ports/mailer'
import type { SignupRepository } from '../../ports/signupRepository'

export interface RefuseSignupInput {
  readonly id: string
  readonly operator: UserId
  /** Tell the person, by a neutral mail with no reason (checked by default in the console). */
  readonly notify: boolean
}

export interface RefuseSignupDeps {
  readonly signups: Pick<SignupRepository, 'findById' | 'refuse'>
  readonly mailer: Mailer
  readonly audit: AuditRecorder
  readonly clock: Clock
  readonly logger: Logger
  /** The self-hosting guide the mail points to. */
  readonly selfHostLink: string
  /** `OPERATOR_CONTACT_EMAIL`: where an answer to the mail goes; `null` leaves no `Reply-To`. */
  readonly replyTo: EmailAddress | null
}

export type RefuseSignup = (input: RefuseSignupInput) => Promise<Result<void, DomainError>>

/**
 * An operator refuses a confirmed request (`pending` to `refused`, spec 31): no reason is asked, kept or
 * mailed. The refusal holds the address silent for 30 days (retention), and is erased with the request.
 *
 * `404 signup.notFound` for an id nobody holds or a request nobody confirmed, `409 signup.notPending`
 * for one already decided or being approved. The audit line follows the transition and says only whether
 * the person was told. The mail is sent after, and **a mail that does not go does not undo the refusal**:
 * the operator decided, and the relay's failure is logged without the address.
 */
export const makeRefuseSignup =
  ({
    signups,
    mailer,
    audit,
    clock,
    logger,
    selfHostLink,
    replyTo,
  }: RefuseSignupDeps): RefuseSignup =>
  async ({ id, operator, notify }) => {
    const request = await signups.findById(id)
    if (request === null || request.status === 'unconfirmed') {
      return err(DomainError.notFound('signup.notFound'))
    }
    const at = clock.now()
    if (!(await signups.refuse(id, operator, at))) {
      return err(DomainError.conflict('signup.notPending'))
    }

    const line = AuditEntry.create({
      at,
      actor: { kind: 'operator', userId: operator },
      action: 'signup.refused',
      subject: { type: 'access_request', id },
      clientId: null,
      details: { notified: notify },
    })
    if (!line.ok) return line
    await audit.record(line.value)

    if (notify) {
      const mail = signupRefusedMail({
        to: request.email,
        locale: request.locale,
        selfHostLink,
        // The template wants an address; with none configured the field is dropped just below.
        replyTo: replyTo ?? request.email,
      })
      const outgoing =
        replyTo === null ? { to: mail.to, subject: mail.subject, text: mail.text } : mail
      const sent = await mailer.send(outgoing)
      if (!sent.ok) logger.warn('a signup refusal mail was not sent', { reason: sent.error.code })
    }
    return ok(undefined)
  }
