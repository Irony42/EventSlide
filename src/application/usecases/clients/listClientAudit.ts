import type { DomainError } from '../../../domain/shared/errors'
import type { ClientId, UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { AuditLog, AuditPage } from '../../ports/auditLog'
import type { ClientRepository } from '../../ports/clientRepository'
import { resolveOwnedClient } from './ownedClient'

/**
 * What an owner reads of the log of their own client (`GET /api/client/audit`; G2-16 /
 * P3-17, rule R5 of the operator guard): **every** entry written about the client, the
 * operator's, the integrations', the system's and the client's own members', newest first.
 *
 * ## Who, and which client
 *
 * An **owner** of the client, resolved by {@link resolveOwnedClient} from the caller's roster
 * on this request. The client id handed to the log is the one the roster vouched for, never
 * the raw query value, and `AuditLog.list` is **always** given it: there is no path through
 * this use case to an unfiltered page, which is what the operator's own view (`/api/site`)
 * has and a client's must not.
 *
 * ## What it hands back
 *
 * The port's `AuditPage` as it is. Narrowing a record to the fields the client may see (no
 * actor account id, in particular) is the presenter's, in one place and field by field, so a
 * field the log grows later does not reach a client until somebody decides it should.
 */

export interface ListClientAuditInput {
  /** From the **session**, never from the request. */
  readonly actorId: UserId
  /** Needed only by an account in several clients. */
  readonly clientId?: ClientId
  /** The `next` of the previous page. */
  readonly before?: number
  readonly limit: number
}

export interface ListClientAuditDeps {
  readonly clients: Pick<ClientRepository, 'membershipsForUser'>
  readonly audit: Pick<AuditLog, 'list'>
}

export type ListClientAudit = (
  input: ListClientAuditInput,
) => Promise<Result<AuditPage, DomainError>>

export const makeListClientAudit =
  ({ clients, audit }: ListClientAuditDeps): ListClientAudit =>
  async ({ actorId, clientId, before, limit }) => {
    const owned = await resolveOwnedClient(clients, actorId, clientId)
    if (!owned.ok) return owned

    return ok(
      await audit.list({
        clientId: owned.value,
        limit,
        ...(before === undefined ? {} : { before }),
      }),
    )
  }
