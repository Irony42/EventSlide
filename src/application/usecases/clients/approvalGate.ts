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
 * - **An owner of a suspended client** is `403 client.suspended` (roadmap §10.7; G2-14): an
 *   approval is a write on the client, and a suspended client's members read and do not write.
 *   Asked last, so only a caller who is entitled to approve learns that the client is frozen.
 */
export interface ApprovalGateDeps {
  readonly users: Pick<UserRepository, 'findById' | 'siteRoleFor'>
  readonly clients: Pick<ClientRepository, 'memberRole' | 'findById'>
}

export type ApprovalGate = (
  actorId: UserId,
  clientId: ClientId,
  notFoundCode: string,
) => Promise<Result<void, DomainError>>

export interface StandingOwnerDeps {
  readonly users: Pick<UserRepository, 'findById'>
  readonly clients: Pick<ClientRepository, 'memberRole'>
}

/**
 * Whether this account is **right now** an owner of this client who may act as one: it exists,
 * it can sign in, it does not operate the box, and the client's roster still has it as an owner.
 * `null` (an author the box no longer has) is nobody.
 *
 * What an approval and an owner's own invitation are worth when they are **spent**, a week or an
 * hour after they were made, as opposed to when they were made: authority is read on the request
 * that uses it (CLAUDE.md §8), and an owner who was removed or switched off in between no longer
 * has consent to give. The same verdict as the gate's (`approvalVerdictFor`), as a yes or a no.
 */
export type IsStandingOwner = (clientId: ClientId, userId: UserId | null) => Promise<boolean>

export const makeIsStandingOwner =
  ({ users, clients }: StandingOwnerDeps): IsStandingOwner =>
  async (clientId, userId) => {
    if (userId === null) return false
    const account = await users.findById(userId)
    if (account === null || !account.canSignIn()) return false
    return (
      approvalVerdictFor({
        siteRole: account.siteRole,
        clientRole: await clients.memberRole(clientId, userId),
      }) === 'ok'
    )
  }

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

    if ((await clients.findById(clientId))?.isSuspended() === true) {
      return err(DomainError.forbidden('client.suspended'))
    }
    return ok(undefined)
  }
