import { DEFAULT_CLIENT_LOCALE } from '../../../domain/clients/clientLocale'
import {
  signupConsoleLink,
  signupOperatorNoticeMail,
  type SignupNoticeKind,
} from '../../../domain/mail/signupMails'
import { signupNoticeDue } from '../../../domain/signups/signupNotice'
import type { EmailAddress } from '../../../domain/users/emailAddress'
import type { Clock } from '../../ports/clock'
import type { Logger } from '../../ports/logger'
import type { Mailer } from '../../ports/mailer'

export interface NotifySignupOperatorDeps {
  readonly mailer: Mailer
  /** `SIGNUP_NOTIFY_EMAIL`, or `null`: nobody to write to. */
  readonly to: EmailAddress | null
  readonly publicUrl: string
  readonly clock: Clock
  readonly logger: Logger
}

/**
 * Tells the operator `count` more signups happened, and sends the mail if the hour allows it. Never rejects.
 * `flush` sends what is held back without adding anything: the retention sweep calls it, so a count the
 * throttle kept is not left waiting for the next signup.
 */
export interface NotifySignupOperator {
  (kind: SignupNoticeKind, count?: number): Promise<void>
  flush(): Promise<void>
}

/**
 * Writes to the operator about signups (spec 31 section 5): **at most one mail an hour**, whatever happens in
 * between. What happens meanwhile is counted in memory, per kind, and **one mail carries every count held**
 * (both kinds) when the hour allows it, so a throttled notice is merged and not lost, and nothing waits for a
 * second hour behind a different kind. The counts live in memory only: **a restart forgets what was held**
 * (it costs a notice, and the console list is still right). The mail names no address and no space, only
 * counts and the link to the console.
 *
 * A refused mail keeps its counts for the next try and does not start the hour.
 */
export const makeNotifySignupOperator = ({
  mailer,
  to,
  publicUrl,
  clock,
  logger,
}: NotifySignupOperatorDeps): NotifySignupOperator => {
  let lastSentAt: Date | null = null
  const held: Record<SignupNoticeKind, number> = { opened: 0, waiting: 0 }

  const sendIfDue = async (): Promise<void> => {
    try {
      if (to === null || !mailer.canDeliver) return
      const kinds = (['opened', 'waiting'] as const).filter((kind) => held[kind] > 0)
      const [first, second] = kinds
      if (first === undefined) return
      const now = clock.now()
      if (!signupNoticeDue(lastSentAt, now)) return

      const mail = signupOperatorNoticeMail({
        to,
        locale: DEFAULT_CLIENT_LOCALE,
        kind: first,
        count: held[first],
        ...(second === undefined ? {} : { also: { kind: second, count: held[second] } }),
        link: signupConsoleLink(publicUrl),
      })
      if (!mail.ok) {
        logger.error('a signup notice could not be written', { code: mail.error.code })
        return
      }
      const sent = await mailer.send(mail.value)
      if (!sent.ok) {
        logger.warn('a signup notice was not sent', { code: sent.error.code })
        return
      }
      held.opened = 0
      held.waiting = 0
      lastSentAt = now
    } catch (error) {
      logger.error('a signup notice failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const notify = async (kind: SignupNoticeKind, count = 1): Promise<void> => {
    held[kind] += count
    await sendIfDue()
  }

  return Object.assign(notify, { flush: sendIfDue })
}
