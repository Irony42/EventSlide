import { DomainError } from '../../../domain/shared/errors'
import type { ClientId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ClientRepository } from '../../ports/clientRepository'

/**
 * Which client an account is asking about in its own space, and whether it may read what that
 * client keeps for its owners (the audit log, what waits for an approval: G2-16 / P3-17).
 *
 * **One reading of "which client", for every route of the space that takes an optional
 * `clientId`**, and the same one `createEvent` applies: an account in one client means that
 * client; an account in several has to say which; one that says a client it is not a member of
 * is answered as if the client did not exist.
 *
 * - `404 client.notFound` for a caller with no part in the client: one that does not exist,
 *   one the caller merely knows the id of, and a caller with several clients who named none.
 *   A `403` would confirm the client exists, and this surface is not a way to enumerate them.
 * - `403 client.ownerRequired` for a **member who is not an owner**: they are in the client and
 *   know it exists, so the refusal says what is missing. The log of what the operator did to a
 *   client is the owner's to read, because it is the owner who answers for the account.
 *
 * Authority is read from the roster on this request, never from the session.
 */
export const resolveOwnedClient = async (
  clients: Pick<ClientRepository, 'membershipsForUser'>,
  userId: UserId,
  named: ClientId | undefined,
): Promise<Result<ClientId, DomainError>> => {
  const memberships = await clients.membershipsForUser(userId)

  const chosen =
    named !== undefined
      ? memberships.find((membership) => membership.clientId === named)
      : memberships.length === 1
        ? memberships[0]
        : undefined
  if (chosen === undefined) return err(DomainError.notFound('client.notFound'))

  return chosen.role === 'owner'
    ? ok(chosen.clientId)
    : err(DomainError.forbidden('client.ownerRequired'))
}
