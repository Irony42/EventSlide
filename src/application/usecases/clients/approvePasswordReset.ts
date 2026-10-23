import { AuditEntry } from '../../../domain/audit/auditEntry'
import { DomainError } from '../../../domain/shared/errors'
import type { AccountTokenId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import { isAccountTokenUsable } from '../../../domain/users/accountToken'
import type { AccountTokenRepository } from '../../ports/accountTokenRepository'
import type { AuditRecorder } from '../../ports/auditLog'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { UserRepository } from '../../ports/userRepository'
import { makeApprovalGate } from './approvalGate'

export interface ApprovePasswordResetInput {
  /** From the **session**, never from the request. */
  readonly actorId: UserId
  /** The id `issuePasswordResetForAccount` answered `pendingApproval` with. Never a link. */
  readonly requestId: AccountTokenId
}

export interface ApprovePasswordResetDeps {
  readonly users: Pick<UserRepository, 'findById' | 'siteRoleFor'>
  readonly clients: Pick<ClientRepository, 'memberRole' | 'findById' | 'membershipsForUser'>
  readonly tokens: Pick<AccountTokenRepository, 'findById' | 'approve'>
  /** Only the writing half of the log: this use case cannot prune it. */
  readonly audit: AuditRecorder
  readonly clock: Clock
}

export type ApprovePasswordReset = (
  input: ApprovePasswordResetInput,
) => Promise<Result<void, DomainError>>

/** One refusal for every request the caller may not approve, whatever the reason. */
const NOT_FOUND = 'reset.requestNotFound'

/**
 * **Another** owner of an account's client lets an operator be handed that account's
 * password-reset link (the operator guard's **R2**, the `copyLinkWithOwnerApproval` opt-in of
 * D-16; free plan G2-12, paid plan P3-14).
 *
 * It is the same consent as {@link makeApproveInvitation}'s and judged by the same gate
 * (`approvalGate`): an owner of the client, who does not operate the box. Two things are added,
 * because the thing approved is somebody's **password** and not a place in an account.
 *
 * - **The owner is not the account.** An account cannot approve the reset of itself: the
 *   request is exactly the situation in which its holder cannot sign in, and a plan that lets
 *   the person being reset consent to it is no second pair of eyes.
 * - **The account belongs to exactly one client.** Whose consent is it when it belongs to two?
 *   Both owners', and an approval records one. So an account in two clients, or in none, has
 *   no such approval and the operator's other way (mail, or the break-glass command of D-16)
 *   is what is left. Fail closed rather than "any one of them will do".
 *
 * Approving does not hand anyone a link: it makes the request redeemable, once, by the
 * operator who made it (`issuePasswordResetForAccount` with the request's id), who is then
 * given a link that did not exist until that moment. One line is written for it,
 * `account.resetApproved`, with the owner as the actor and **before** the approval is
 * recorded.
 *
 * Everything else is `404 reset.requestNotFound`, one answer: an id that is unknown, an
 * invitation's, a request that is already spent, revoked or expired, a request for an account
 * of another client, and a caller who is no part of the client.
 */
export const makeApprovePasswordReset = ({
  users,
  clients,
  tokens,
  audit,
  clock,
}: ApprovePasswordResetDeps): ApprovePasswordReset => {
  const gate = makeApprovalGate({ users, clients })

  return async ({ actorId, requestId }) => {
    const now = clock.now()

    const request = await tokens.findById(requestId)
    if (
      request === null ||
      request.purpose !== 'passwordReset' ||
      request.userId === null ||
      !request.requiresApproval ||
      request.consumedAt !== null ||
      request.revokedAt !== null ||
      request.expiresAt.getTime() <= now.getTime()
    ) {
      return err(DomainError.notFound(NOT_FOUND))
    }

    const accountClients = await clients.membershipsForUser(request.userId)
    const only = accountClients.length === 1 ? accountClients[0] : undefined
    if (only === undefined) return err(DomainError.notFound(NOT_FOUND))

    const allowed = await gate(actorId, only.clientId, NOT_FOUND)
    if (!allowed.ok) return allowed
    if (actorId === request.userId) return err(DomainError.forbidden('auth.forbidden'))

    if (isAccountTokenUsable(request, now)) return ok(undefined)

    const entry = AuditEntry.create({
      at: now,
      actor: { kind: 'member', userId: actorId },
      action: 'account.resetApproved',
      subject: { type: 'account', id: request.userId },
      clientId: only.clientId,
      details: {},
    })
    if (!entry.ok) return entry
    await audit.record(entry.value)

    if (await tokens.approve(request.id, actorId, now)) return ok(undefined)

    const after = await tokens.findById(request.id)
    return after !== null && isAccountTokenUsable(after, now)
      ? ok(undefined)
      : err(DomainError.notFound(NOT_FOUND))
  }
}
