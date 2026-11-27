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

/** Tells the operator `count` more signups happened. Never rejects. */
export type NotifySignupOperator = (kind: SignupNoticeKind, count?: number) => Promise<void>

/**
 * Writes to the operator about signups (spec 31 section 5): **at most one mail an hour**, whatever happens
 * in between. What happens meanwhile is counted per kind in memory and goes out in the next mail, so a
 * throttled notice is merged and not lost. A restart forgets the counter, which costs one more mail,
 * never one fewer. The mail names no address and no space, only a count and the link to the console.
 *
 * The mail that goes carries the kind that triggered it; a count of the other kind waits for its own turn.
 * A refused mail keeps its count for the next try (and does not start the hour).
 */
export const makeNotifySignupOperator = ({
  mailer,
  to,
  publicUrl,
  clock,
  logger,
}: NotifySignupOperatorDeps): NotifySignupOperator => {
  let lastSentAt: Date | null = null
  const waiting: Record<SignupNoticeKind, number> = { opened: 0, waiting: 0 }

  return async (kind, count = 1) => {
    try {
      if (to === null || !mailer.canDeliver) return
      waiting[kind] += count
      const now = clock.now()
      if (!signupNoticeDue(lastSentAt, now)) return

      const mail = signupOperatorNoticeMail({
        to,
        locale: DEFAULT_CLIENT_LOCALE,
        kind,
        count: waiting[kind],
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
      waiting[kind] = 0
      lastSentAt = now
    } catch (error) {
      logger.error('a signup notice failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
