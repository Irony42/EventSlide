import { passwordResetLink, passwordResetMail } from '../../../domain/mail/passwordResetMail'
import type { ClientLocale } from '../../../domain/clients/clientLocale'
import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import {
  ACCOUNT_TOKEN_LIFETIME_MS,
  ACCOUNT_TOKEN_RETENTION_AFTER_EXPIRY_MS,
  PASSWORD_RESET_MAX_REQUESTS_PER_HOUR,
  PASSWORD_RESET_REQUEST_WINDOW_MS,
  issueAccountToken,
} from '../../../domain/users/accountToken'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { AccountTokenRepository } from '../../ports/accountTokenRepository'
import type { Clock } from '../../ports/clock'
import type { IdGenerator } from '../../ports/idGenerator'
import type { Logger } from '../../ports/logger'
import type { Mailer } from '../../ports/mailer'
import type { SecretTokens } from '../../ports/secretTokens'
import type { UserRepository } from '../../ports/userRepository'

export interface RequestPasswordResetInput {
  /** What the person typed. Parsed here, and never echoed back to them. */
  readonly email: string
  /** The language of the page they asked from; the mail is written in it. */
  readonly locale: ClientLocale
}

export interface RequestPasswordResetDeps {
  /** Only the lookup by address: this cannot read anything else about an account. */
  readonly users: Pick<UserRepository, 'findByEmail'>
  readonly tokens: AccountTokenRepository
  readonly secrets: SecretTokens
  readonly mailer: Mailer
  readonly ids: Pick<IdGenerator, 'accountTokenId'>
  readonly clock: Clock
  readonly logger: Logger
  /** `PUBLIC_URL`, without a trailing slash: the origin the link in the mail points at. */
  readonly publicUrl: string
}

export interface PasswordResetRequested {
  /**
   * Resolves when the work behind the request has finished — the lookup, the token, the
   * mail. **It never rejects**: a failure is logged, by code, and swallowed, because the
   * person who asked is not told whether there was anything to do.
   *
   * The HTTP layer does not wait for it. A caller that did would learn from how long the
   * answer took whether the address belongs to an account, and a relay that takes two
   * seconds to accept a message is two seconds of difference nobody can hide. A test awaits
   * it, which is what makes the use case testable without sleeping.
   */
  readonly completion: Promise<void>
}

export type RequestPasswordReset = (
  input: RequestPasswordResetInput,
) => Promise<Result<PasswordResetRequested, DomainError>>

/**
 * "I forgot my password" (roadmap §10.3; free plan G2-08, paid plan P3-09): mails a one-hour,
 * single-use link to the address, **if** an enabled account uses it — and tells nobody which.
 *
 * ## What this answers, and what it never does
 *
 * - **`404 feature.unavailable` when the box cannot send mail** (`NullMailer`), and only
 *   then. A reset link has to travel through the mailbox it proves control of; showing it on
 *   the screen of whoever typed the address would let anyone take over any account, which is
 *   the opposite of a reset. That is the difference from an *invitation*, where the person
 *   holding the screen is the host who created it. A box with no relay therefore has no
 *   self-service reset (`features.forgotPassword` is `false`, so the sign-in page does not
 *   offer one) and an operator who is asked for help resets the password by hand. The answer
 *   depends on configuration alone — never on the address — so it is not an oracle.
 * - **Everything else is the same answer** (`ok`, then `202`): an address that is unknown, a
 *   malformed one, a disabled account, one over its hourly cap, and a real account that was
 *   just mailed. The work happens behind {@link PasswordResetRequested.completion}, which the
 *   caller does not wait for, so the *time* is the same too.
 *
 * ## The work
 *
 * 1. Housekeeping: rows that expired more than a day ago are deleted (they hold an address).
 * 2. An address that is not an enabled account ends here, silently.
 * 3. **At most {@link PASSWORD_RESET_MAX_REQUESTS_PER_HOUR} mails an hour per address.** The
 *    per-client rate limit bounds an attacker's speed and says nothing about *whom* they
 *    write to; this bounds how many mails any inbox can be made to receive. Beyond the cap
 *    nothing is issued or sent, and the answer is unchanged.
 * 4. Any earlier link for this address is revoked, then a new one is issued: **there is only
 *    ever one link that works, and the newest one is it.**
 * 5. The mail is sent. A relay that refuses or times out is logged by its code and nothing
 *    more; the link stays issued, and the person asks again.
 *
 * ## What is never logged
 *
 * Not the address, not the token, not the link: a log shipper holding a reset link is a
 * leaked credential. The only things written are a message and a failure code. `smtpMailer`
 * keeps the same rule from its side, and `passwordResetLogCanary.test.ts` plants all three
 * and reads the output.
 */
export const makeRequestPasswordReset = ({
  users,
  tokens,
  secrets,
  mailer,
  ids,
  clock,
  logger,
  publicUrl,
}: RequestPasswordResetDeps): RequestPasswordReset => {
  const run = async ({ email, locale }: RequestPasswordResetInput): Promise<void> => {
    const now = clock.now()

    await tokens.deleteExpired(new Date(now.getTime() - ACCOUNT_TOKEN_RETENTION_AFTER_EXPIRY_MS))

    const address = EmailAddress.create(email)
    if (!address.ok) return

    const user = await users.findByEmail(address.value)
    // A disabled account cannot sign in, so there is nothing a new password would open.
    if (user === null || !user.canSignIn()) return

    const recent = await tokens.countCreatedSince(
      user.email,
      'passwordReset',
      new Date(now.getTime() - PASSWORD_RESET_REQUEST_WINDOW_MS),
    )
    if (recent >= PASSWORD_RESET_MAX_REQUESTS_PER_HOUR) {
      logger.info('a password reset request was dropped: its address is over the hourly cap')
      return
    }

    const minted = secrets.mint()
    const issued = issueAccountToken(
      {
        purpose: 'passwordReset',
        tokenDigest: minted.digest,
        email: user.email,
        userId: user.id,
        delivery: 'mail',
        // Nobody signed in asked for this. The requester is, by definition, a stranger to
        // the box until they hold the link.
        createdBy: null,
      },
      ids.accountTokenId(),
      now,
    )
    if (!issued.ok) {
      logger.error('a password reset token could not be issued', { code: issued.error.code })
      return
    }

    // Revoke before saving, never after: the new token must not be one of the outstanding
    // ones it revokes.
    await tokens.revokeOutstanding(user.email, 'passwordReset', now)
    await tokens.save(issued.value)

    const sent = await mailer.send(
      passwordResetMail({
        to: user.email,
        locale,
        link: passwordResetLink(publicUrl, minted.token),
        lifetimeMinutes: ACCOUNT_TOKEN_LIFETIME_MS.passwordReset / 60_000,
      }),
    )
    if (!sent.ok) {
      logger.warn('a password reset mail was not sent', { code: sent.error.code })
    }
  }

  return async (input) => {
    // Configuration, not the address: the one refusal that may differ between two calls.
    if (!mailer.canDeliver) return err(DomainError.notFound('feature.unavailable'))

    const completion = run(input).catch((error: unknown) => {
      logger.error('a password reset request failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
    return ok({ completion })
  }
}
