import { AuditEntry } from '../../../domain/audit/auditEntry'
import type { ClientLocale } from '../../../domain/clients/clientLocale'
import { operatorResetPlan, type OperatorResetLinks } from '../../../domain/clients/operatorGuard'
import { passwordResetLink, passwordResetMail } from '../../../domain/mail/passwordResetMail'
import { DomainError } from '../../../domain/shared/errors'
import type { AccountTokenId, ClientId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import {
  ACCOUNT_TOKEN_LIFETIME_MS,
  ACCOUNT_TOKEN_RETENTION_AFTER_EXPIRY_MS,
  PASSWORD_RESET_MAX_REQUESTS_PER_HOUR,
  PASSWORD_RESET_REQUEST_WINDOW_MS,
  isAccountTokenUsable,
  issueAccountToken,
  type AccountToken,
} from '../../../domain/users/accountToken'
import type { AccountTokenRepository } from '../../ports/accountTokenRepository'
import type { AuditRecorder } from '../../ports/auditLog'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { IdGenerator } from '../../ports/idGenerator'
import type { Logger } from '../../ports/logger'
import type { Mailer } from '../../ports/mailer'
import type { SecretTokens } from '../../ports/secretTokens'
import type { UserRepository } from '../../ports/userRepository'

export interface IssuePasswordResetForAccountInput {
  /** The operator asking. Their site role is read from storage, here. */
  readonly actorId: UserId
  /** The account whose password it is. */
  readonly userId: UserId
  /** The language of the operator's page: the language the mail to the account is written in. */
  readonly locale: ClientLocale
  /**
   * The id of a request an owner has approved (`approvePasswordReset`), to redeem it. Only
   * ever meaningful under `copyLinkWithOwnerApproval` on a box with no mail relay.
   */
  readonly approvalId?: AccountTokenId
}

/**
 * What an operator is told. **There is no variant in which the answer to "mail" carries a
 * link**, and the one that does (`link`) is reachable on exactly one path: a box with no mail
 * relay, `copyLinkWithOwnerApproval`, and an owner's approval of this very request.
 */
export type OperatorResetOutcome =
  | { readonly delivery: 'mail'; readonly expiresAt: Date }
  | {
      readonly delivery: 'pendingApproval'
      /** What the account's owner is told to approve, and what the operator redeems. Not a secret. */
      readonly approvalId: AccountTokenId
      readonly expiresAt: Date
    }
  | { readonly delivery: 'link'; readonly link: string; readonly expiresAt: Date }

export interface IssuePasswordResetForAccountDeps {
  readonly users: Pick<UserRepository, 'findById' | 'siteRoleFor'>
  readonly clients: Pick<ClientRepository, 'membershipsForUser'>
  readonly tokens: AccountTokenRepository
  readonly secrets: SecretTokens
  readonly mailer: Mailer
  readonly ids: Pick<IdGenerator, 'accountTokenId'>
  readonly clock: Clock
  readonly logger: Logger
  /** `PUBLIC_URL`, without a trailing slash: the origin the link in the mail points at. */
  readonly publicUrl: string
  /** `OPERATOR_RESET_LINKS`. See `OperatorResetLinks`. */
  readonly mode: OperatorResetLinks
  /** Only the writing half of the log: this use case cannot prune it. */
  readonly audit: AuditRecorder
}

export type IssuePasswordResetForAccount = (
  input: IssuePasswordResetForAccountInput,
) => Promise<Result<OperatorResetOutcome, DomainError>>

/**
 * An operator resets somebody else's password (the operator guard's **R2**; free plan G2-12,
 * paid plan P3-14, decision D-16): the one place a link that can take over an account is
 * written on an operator's say-so, and so the one place the answer is held to the rule that
 * **the link goes to the account's own mailbox and nowhere else**.
 *
 * ## What happens, in the order it is decided (`operatorResetPlan`)
 *
 * 1. **The box can mail** (in either mode): a one-hour link is mailed to the address on
 *    record. The answer is `{delivery: 'mail'}`: **no token, no link, no address.** What the
 *    operator learns is that the mail went, which they could tell from the account's owner.
 * 2. **The box cannot mail, `OPERATOR_RESET_LINKS=mailOnly`** (the default): **nothing is
 *    issued**, and the answer is `409 reset.mailerRequired`. An operator who cannot reset a
 *    password on a box with no relay is an inconvenience the plan accepts; the way out is
 *    the break-glass command of D-16, which asks for a written reason and writes a line the
 *    client reads.
 * 3. **No relay, `copyLinkWithOwnerApproval`** (an opt-in that weakens the invariant, said so
 *    in docs/SECURITY.md): the first call writes a **request** and answers
 *    `{delivery: 'pendingApproval', approvalId}`. The request is a reset token that **has no
 *    secret anywhere** (the one minted for its row is dropped here) and cannot be spent by
 *    anybody; **another owner of the account's client** approves it (`approvePasswordReset`);
 *    and only then does a second call, carrying that id, spend the request once and issue a
 *    link, which is the only link this use case ever returns.
 *
 * ## Why the checks are here and not in the route
 *
 * - **The caller is an operator, read from storage on this call.** A rule about operators
 *   that applied to whoever the route said was one would apply to nobody the day a route
 *   forgot the gate. A non-operator is `403 auth.forbidden`.
 * - **The redemption is bound to its request**: same operator, same account, approved, unspent,
 *   unexpired. An approval is one consent for one thing.
 * - **An operator never reads a link that was mailed.** There is no code path from the mail
 *   branch to a returned link, and `issuePasswordResetForAccount.test.ts` plants the token and
 *   the link in the mailer and requires the answer to hold neither.
 *
 * ## What is written (R5)
 *
 * One audit line per client the account belongs to (or one with no client, for an account that
 * belongs to none), so each owner reads it in their own log: `account.resetIssued
 * {linkShown}` for a mail (`false`) or a link handed over (`true`), and
 * `account.resetRequested` for the request of case 3. The line is recorded **before** the link
 * is saved or the mail is sent: a reset with no line is the failure that matters.
 *
 * ## What it shares with the self-service reset, and what it does not
 *
 * The token is the same kind (`passwordReset`, one hour, `resetPassword` spends it), so the
 * account holder's own password change, the credentials epoch and "one live link per address"
 * are unchanged, and the hourly cap per address counts these too: three mails an hour to one
 * inbox, however they were asked for. It carries the operator as its author, and the claim in
 * case 3 is the only token anywhere with `delivery: 'link'` for a reset.
 */
export const makeIssuePasswordResetForAccount = ({
  users,
  clients,
  tokens,
  secrets,
  mailer,
  ids,
  clock,
  logger,
  publicUrl,
  mode,
  audit,
}: IssuePasswordResetForAccountDeps): IssuePasswordResetForAccount => {
  /** A request is an hour old at most, so a claim cannot outlive the mail it replaces. */
  const lifetimeMinutes = ACCOUNT_TOKEN_LIFETIME_MS.passwordReset / 60_000

  const auditLines = async (
    action: 'account.resetIssued' | 'account.resetRequested',
    base: {
      readonly at: Date
      readonly actorId: UserId
      readonly userId: UserId
      readonly clientIds: readonly ClientId[]
      readonly linkShown: boolean
    },
  ): Promise<Result<readonly AuditEntry[], DomainError>> => {
    const entries: AuditEntry[] = []
    // One per client, so that each of an account's owners finds it in their own log; one with
    // no client for an account that belongs to none, which only the operator's log shows.
    for (const clientId of base.clientIds.length === 0 ? [null] : base.clientIds) {
      const entry = AuditEntry.create({
        at: base.at,
        actor: { kind: 'operator', userId: base.actorId },
        action,
        subject: { type: 'account', id: base.userId },
        clientId,
        details: action === 'account.resetIssued' ? { linkShown: base.linkShown } : {},
      })
      if (!entry.ok) return entry
      entries.push(entry.value)
    }
    return ok(entries)
  }

  return async ({ actorId, userId, locale, approvalId }) => {
    if ((await users.siteRoleFor(actorId)) !== 'operator') {
      return err(DomainError.forbidden('auth.forbidden', { required: 'operator' }))
    }

    const user = await users.findById(userId)
    if (user === null) return err(DomainError.notFound('user.notFound'))
    // A disabled account cannot sign in, so there is nothing a new password would open, and a
    // link for it would be a credential that opens nothing and looks like one.
    if (!user.canSignIn()) return err(DomainError.conflict('account.disabled'))

    const now = clock.now()
    const accountClients = (await clients.membershipsForUser(user.id)).map(
      (membership) => membership.clientId,
    )

    // The request being redeemed, and only if it is exactly what the operator says it is.
    let approved: AccountToken | null = null
    if (approvalId !== undefined) {
      const request = await tokens.findById(approvalId)
      if (
        request === null ||
        request.purpose !== 'passwordReset' ||
        request.userId !== user.id ||
        request.createdBy !== actorId ||
        !request.requiresApproval ||
        !isAccountTokenUsable(request, now)
      ) {
        return err(DomainError.notFound('reset.requestNotFound'))
      }
      approved = request
    }

    const plan = operatorResetPlan({
      mode,
      mailerCanDeliver: mailer.canDeliver,
      ownerApproved: approved !== null,
    })

    if (plan === 'refused') return err(DomainError.conflict('reset.mailerRequired'))
    // Exactly one client: whose consent is it otherwise? See `approvePasswordReset`.
    if (plan === 'needsApproval' && accountClients.length !== 1) {
      return err(DomainError.conflict('reset.approverUnavailable'))
    }

    await tokens.deleteExpired(new Date(now.getTime() - ACCOUNT_TOKEN_RETENTION_AFTER_EXPIRY_MS))

    const redeemed = plan === 'link' ? approved : null
    if (redeemed !== null) {
      // Spent before the link exists: one approval, one link, whoever else is asking.
      if (!(await tokens.consume(redeemed.id, now))) {
        return err(DomainError.notFound('reset.requestNotFound'))
      }
    } else {
      const recent = await tokens.countCreatedSince(
        user.email,
        'passwordReset',
        new Date(now.getTime() - PASSWORD_RESET_REQUEST_WINDOW_MS),
      )
      if (recent >= PASSWORD_RESET_MAX_REQUESTS_PER_HOUR) {
        return err(DomainError.rateLimited('reset.tooManyForAddress'))
      }
    }

    if (plan === 'needsApproval') {
      // The secret minted for this row is dropped, not kept and not returned: nobody holds the
      // token of a request, so the row cannot be spent by anybody, approved or not.
      const request = issueAccountToken(
        {
          purpose: 'passwordReset',
          tokenDigest: secrets.mint().digest,
          email: user.email,
          userId: user.id,
          delivery: 'link',
          requiresApproval: true,
          createdBy: actorId,
        },
        ids.accountTokenId(),
        now,
      )
      if (!request.ok) return request

      const lines = await auditLines('account.resetRequested', {
        at: now,
        actorId,
        userId: user.id,
        clientIds: accountClients,
        linkShown: false,
      })
      if (!lines.ok) return lines
      for (const line of lines.value) await audit.record(line)

      await tokens.save(request.value)
      return ok({
        delivery: 'pendingApproval',
        approvalId: request.value.id,
        expiresAt: request.value.expiresAt,
      })
    }

    const minted = secrets.mint()
    const issued = issueAccountToken(
      {
        purpose: 'passwordReset',
        tokenDigest: minted.digest,
        email: user.email,
        userId: user.id,
        delivery: plan === 'mail' ? 'mail' : 'link',
        createdBy: actorId,
      },
      ids.accountTokenId(),
      now,
    )
    if (!issued.ok) return issued

    const lines = await auditLines('account.resetIssued', {
      at: now,
      actorId,
      userId: user.id,
      clientIds: accountClients,
      linkShown: plan === 'link',
    })
    if (!lines.ok) return lines
    for (const line of lines.value) await audit.record(line)

    // Revoke before saving, never after: the new token must not be one of the outstanding
    // ones it revokes, and there is only ever one link that works.
    await tokens.revokeOutstanding(user.email, 'passwordReset', now)
    await tokens.save(issued.value)

    const link = passwordResetLink(publicUrl, minted.token)

    if (plan === 'link') {
      return ok({ delivery: 'link', link, expiresAt: issued.value.expiresAt })
    }

    const sent = await mailer.send(
      passwordResetMail({ to: user.email, locale, link, lifetimeMinutes }),
    )
    if (!sent.ok) {
      logger.warn('an operator-initiated password reset mail was not sent', {
        code: sent.error.code,
      })
      return err(DomainError.conflict('reset.mailNotSent'))
    }
    return ok({ delivery: 'mail', expiresAt: issued.value.expiresAt })
  }
}
