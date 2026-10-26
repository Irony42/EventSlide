import type { ClientRole } from '../../../domain/clients/clientRole'
import type { DomainError } from '../../../domain/shared/errors'
import type { AccountTokenId, ClientId, UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { AccountTokenRepository } from '../../ports/accountTokenRepository'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import { resolveOwnedClient } from './ownedClient'

/**
 * What waits for an owner's approval (`GET /api/client/invitations`; G2-16 / P3-17, the list
 * R1 of the operator guard promises): the operator's invitations into this client that cannot
 * be used until an owner lets them in, with **whom they are for**, which is exactly what an
 * owner needs to decide and what the approval route's own answer withholds.
 *
 * Only an owner of the client reads it ({@link resolveOwnedClient}), the query is scoped by
 * the client the roster vouched for (`listAwaitingApproval` cannot return another client's
 * row), and an entry carries what an owner decides on and nothing else: no link, no digest, no
 * operator account. The address is the one thing it shows that the audit log never does: it is
 * the invitee's, shown to the people whose account the invitee would join.
 */

/** More than a client will ever have waiting: an operator's invitations are written by hand. */
export const PENDING_INVITATIONS_LIMIT = 50

export interface PendingInvitation {
  readonly id: AccountTokenId
  readonly clientId: ClientId
  readonly email: string
  readonly role: ClientRole
  readonly createdAt: Date
  readonly expiresAt: Date
}

export interface ListPendingInvitationsInput {
  /** From the **session**, never from the request. */
  readonly actorId: UserId
  /** Needed only by an account in several clients. */
  readonly clientId?: ClientId
}

export interface ListPendingInvitationsDeps {
  readonly clients: Pick<ClientRepository, 'membershipsForUser'>
  readonly tokens: Pick<AccountTokenRepository, 'listAwaitingApproval'>
  readonly clock: Clock
}

export type ListPendingInvitations = (
  input: ListPendingInvitationsInput,
) => Promise<Result<readonly PendingInvitation[], DomainError>>

export const makeListPendingInvitations =
  ({ clients, tokens, clock }: ListPendingInvitationsDeps): ListPendingInvitations =>
  async ({ actorId, clientId }) => {
    const owned = await resolveOwnedClient(clients, actorId, clientId)
    if (!owned.ok) return owned

    const waiting = await tokens.listAwaitingApproval(
      owned.value,
      clock.now(),
      PENDING_INVITATIONS_LIMIT,
    )
    return ok(
      waiting.flatMap((token) =>
        // An invitation into a client always carries both; the guard keeps the type honest.
        token.clientId === null || token.clientRole === null
          ? []
          : [
              {
                id: token.id,
                clientId: token.clientId,
                email: token.email.value,
                role: token.clientRole,
                createdAt: token.createdAt,
                expiresAt: token.expiresAt,
              },
            ],
      ),
    )
  }
