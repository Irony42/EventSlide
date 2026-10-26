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

export interface ApproveInvitationInput {
  /** From the **session**, never from the request. */
  readonly actorId: UserId
  readonly invitationId: AccountTokenId
}

export interface ApproveInvitationDeps {
  readonly users: Pick<UserRepository, 'findById' | 'siteRoleFor'>
  readonly clients: Pick<ClientRepository, 'memberRole' | 'findById'>
  readonly tokens: Pick<AccountTokenRepository, 'findById' | 'approve'>
  /** Only the writing half of the log: this use case cannot prune it. */
  readonly audit: AuditRecorder
  readonly clock: Clock
}

export type ApproveInvitation = (
  input: ApproveInvitationInput,
) => Promise<Result<void, DomainError>>

/** One refusal for every invitation the caller may not approve, whatever the reason. */
const NOT_FOUND = 'invitation.notFound'

/**
 * An owner of a client lets an operator's invitation in (the operator guard's **R1**; free
 * plan G2-12, paid plan P3-14): `POST /api/client/invitations/:id/approve`.
 *
 * ## What is approved, and by whom
 *
 * An invitation **into this owner's client** that is waiting for an approval. The approver is
 * a signed-in **owner** of that client who does **not** operate the box (`approvalGate`): an
 * approval is the client's consent, and an operator who could give it to their own invitation
 * would have removed the one thing R1 stands on. A member who is not an owner is refused too.
 *
 * Everything that is not that is `404 invitation.notFound`, one answer: an id that is unknown,
 * one that belongs to **another client's** invitation, an invitation to an event (they never
 * wait for anybody), a reset link, one that was already spent, revoked or expired, and a caller
 * who is no part of the client. An owner of one client cannot learn which invitations another
 * has by trying ids.
 *
 * ## What it does
 *
 * Records who approved and when (`AccountTokenRepository.approve`, one conditional statement),
 * which is all that makes the link spendable: **approving does not spend it and does not
 * create anybody**. The invitee still has to open the link and accept it. Approving an
 * invitation that is already approved is a success that changes nothing and writes nothing,
 * so a second click leaves one line in the log.
 *
 * It writes one line, `invitation.approved`, with the owner as the actor (R5), **before** the
 * approval is recorded: an approval with no line is the failure that matters.
 */
export const makeApproveInvitation = ({
  users,
  clients,
  tokens,
  audit,
  clock,
}: ApproveInvitationDeps): ApproveInvitation => {
  const gate = makeApprovalGate({ users, clients })

  return async ({ actorId, invitationId }) => {
    const now = clock.now()

    const invitation = await tokens.findById(invitationId)
    if (
      invitation === null ||
      invitation.purpose !== 'invitation' ||
      invitation.clientId === null ||
      !invitation.requiresApproval ||
      invitation.consumedAt !== null ||
      invitation.revokedAt !== null ||
      invitation.expiresAt.getTime() <= now.getTime()
    ) {
      return err(DomainError.notFound(NOT_FOUND))
    }

    const allowed = await gate(actorId, invitation.clientId, NOT_FOUND)
    if (!allowed.ok) return allowed

    if (isAccountTokenUsable(invitation, now)) return ok(undefined)

    const entry = AuditEntry.create({
      at: now,
      actor: { kind: 'member', userId: actorId },
      action: 'invitation.approved',
      subject: { type: 'invitation', id: invitation.id },
      clientId: invitation.clientId,
      details: {},
    })
    if (!entry.ok) return entry
    await audit.record(entry.value)

    if (await tokens.approve(invitation.id, actorId, now)) return ok(undefined)

    // Somebody else approved it between the read and the write, or it died: say which.
    const after = await tokens.findById(invitation.id)
    return after !== null && isAccountTokenUsable(after, now)
      ? ok(undefined)
      : err(DomainError.notFound(NOT_FOUND))
  }
}
