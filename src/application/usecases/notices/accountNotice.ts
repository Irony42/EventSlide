import type { ClientLocale } from '../../../domain/clients/clientLocale'
import { DEFAULT_CLIENT_LOCALE } from '../../../domain/clients/clientLocale'
import {
  accountChangeMail,
  accountForgotUrl,
  type AccountChangeKind,
} from '../../../domain/mail/accountChangeMail'
import { budgetDayOf } from '../../../domain/notices/mailPreferences'
import type { UserId } from '../../../domain/shared/ids'
import type { EmailAddress } from '../../../domain/users/emailAddress'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { Logger } from '../../ports/logger'
import type { MailBudget } from '../../ports/mailBudget'
import type { Mailer } from '../../ports/mailer'
import type { UserRepository } from '../../ports/userRepository'

/**
 * Telling an account holder what was done to the account (spec 32, A1, A1b, A1c).
 *
 * A use case that changes an account (a password, a second factor, the recovery codes, an operator's switch-off
 * or switch-on, an erasure) hands the account and the kind of change to this, **after its write succeeded**, and
 * never waits for it: the mail is a completion that catches everything, so a relay that is down, slow or refusing
 * never breaks the act, and nothing rejects in the background. The act's own result is the only thing the caller
 * sees.
 *
 * - **Without a relay nothing is read and nothing is sent.** There is nothing to note: no ledger row exists for an
 *   account act (the act itself is the guard, and it happens once).
 * - **Always sent when there is a relay**: no family, no switch, `HOST_MAIL_NOTICES=off` does not stop it. It is
 *   counted in the day's mail budget and never refused by it.
 * - **The address is read before an erasure** ({@link AccountNotice.prepare}): once the account is gone there is
 *   nobody to ask. It is kept in memory for the one send and nowhere else; logs name the kind and the error code,
 *   never the address.
 * - **The language is the oldest client's** of the account (`membershipsForUser`), else French: accounts have no
 *   language of their own. An operator with no client gets French.
 */

export interface PreparedAccountNotice {
  /** Sends the mail without waiting. Never throws, never rejects. */
  send(): void
}

export interface AccountNotice {
  /**
   * Reads the address and the language **now** (before an erasure removes them) and returns what sends the
   * mail later. Never rejects: a failure to read gives a notice that sends nothing.
   */
  prepare(userId: UserId, kind: AccountChangeKind): Promise<PreparedAccountNotice>

  /** `prepare` then `send`, for an act whose account is still there afterwards. Never waits, never throws. */
  notify(userId: UserId, kind: AccountChangeKind): void

  /** Resolves when every mail started so far is over. For a test; nothing in the product waits for it. */
  idle(): Promise<void>
}

/** What a use case that changes an account is given: the two ways to start a notice, nothing else. */
export type AccountNoticeHook = Pick<AccountNotice, 'prepare' | 'notify'>

export interface AccountNoticeDeps {
  readonly users: Pick<UserRepository, 'findById'>
  readonly clients: Pick<ClientRepository, 'membershipsForUser' | 'findById'>
  readonly mailer: Mailer
  readonly budget: Pick<MailBudget, 'count'>
  readonly clock: Clock
  readonly logger: Logger
  /** `PUBLIC_URL` without a trailing slash. */
  readonly publicUrl: string
  /** The operator's contact address (`OPERATOR_CONTACT_EMAIL`), `null` for none. */
  readonly operatorContact: EmailAddress | null
}

const NOTHING: PreparedAccountNotice = { send: () => {} }

export const makeAccountNotice = ({
  users,
  clients,
  mailer,
  budget,
  clock,
  logger,
  publicUrl,
  operatorContact,
}: AccountNoticeDeps): AccountNotice => {
  const inFlight = new Set<Promise<void>>()

  const track = (work: Promise<void>): void => {
    inFlight.add(work)
    void work.finally(() => inFlight.delete(work))
  }

  const failed = (kind: AccountChangeKind, error: unknown): void => {
    logger.error('an account notice failed', {
      kind,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const localeOf = async (userId: UserId): Promise<ClientLocale> => {
    const memberships = await clients.membershipsForUser(userId)
    const oldest = [...memberships].sort((a, b) => a.grantedAt.getTime() - b.grantedAt.getTime())[0]
    if (oldest === undefined) return DEFAULT_CLIENT_LOCALE
    return (await clients.findById(oldest.clientId))?.locale ?? DEFAULT_CLIENT_LOCALE
  }

  const prepare = async (
    userId: UserId,
    kind: AccountChangeKind,
  ): Promise<PreparedAccountNotice> => {
    if (!mailer.canDeliver) return NOTHING
    try {
      const user = await users.findById(userId)
      if (user === null) return NOTHING
      const to = user.email
      const locale = await localeOf(userId)
      return {
        send: () => {
          track(
            (async () => {
              try {
                const at = clock.now()
                await budget.count(budgetDayOf(at), 1)
                const result = await mailer.send(
                  accountChangeMail({
                    to,
                    locale,
                    kind,
                    at,
                    forgotUrl: accountForgotUrl(publicUrl),
                    replyTo: operatorContact,
                  }),
                )
                if (!result.ok)
                  logger.warn('an account notice was not sent', { kind, code: result.error.code })
              } catch (error) {
                failed(kind, error)
              }
            })(),
          )
        },
      }
    } catch (error) {
      failed(kind, error)
      return NOTHING
    }
  }

  return {
    prepare,
    notify: (userId, kind) => {
      track(
        prepare(userId, kind).then((prepared) => {
          prepared.send()
        }),
      )
    },
    idle: async () => {
      while (inFlight.size > 0) await Promise.all([...inFlight])
    },
  }
}
