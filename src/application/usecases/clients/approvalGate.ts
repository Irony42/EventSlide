import { approvalVerdictFor } from '../../../domain/clients/operatorGuard'
import { DomainError } from '../../../domain/shared/errors'
import type { ClientId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ClientRepository } from '../../ports/clientRepository'
import type { UserRepository } from '../../ports/userRepository'

/**
 * Whether this account may give the client's consent to something that waits for an owner
 * (R1's invitation, R2's reset link). **One reading of "who may approve" for both**, so the
 * two use cases that approve cannot drift into two answers.
 *
 * It reads, from storage and on this request: whether the account still exists and may sign
 * in, what authority it has over the box, and its role in this client. The decision is the
 * domain's (`approvalVerdictFor`); what is added here is the answer the caller gives:
 *
 * - **A stranger, a disabled or deleted account** is answered with `notFoundCode`, exactly as
 *   a request about something that does not exist, an operator included. A caller with no part
 *   in the client learns nothing about it.
 * - **An operator, and a member who is not an owner**, are `403 auth.forbidden`: they are in
 *   scope and not entitled.
 */
export interface ApprovalGateDeps {
  readonly users: Pick<UserRepository, 'findById' | 'siteRoleFor'>
  readonly clients: Pick<ClientRepository, 'memberRole'>
}

export type ApprovalGate = (
  actorId: UserId,
  clientId: ClientId,
  notFoundCode: string,
) => Promise<Result<void, DomainError>>

export const makeApprovalGate =
  ({ users, clients }: ApprovalGateDeps): ApprovalGate =>
  async (actorId, clientId, notFoundCode) => {
    const account = await users.findById(actorId)
    if (account === null || !account.canSignIn()) return err(DomainError.notFound(notFoundCode))

    const verdict = approvalVerdictFor({
      siteRole: await users.siteRoleFor(actorId),
      clientRole: await clients.memberRole(clientId, actorId),
    })

    if (verdict === 'stranger') return err(DomainError.notFound(notFoundCode))
    if (verdict !== 'ok') return err(DomainError.forbidden('auth.forbidden', { required: 'owner' }))
    return ok(undefined)
  }
