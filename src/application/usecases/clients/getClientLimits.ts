import {
  ceilingMeters,
  type CeilingMeter,
  type CeilingUsage,
} from '../../../domain/clients/ceilingUsage'
import type { ClientCeilingsProps } from '../../../domain/clients/clientCeilings'
import type { ClientRole } from '../../../domain/clients/clientRole'
import type { DomainError } from '../../../domain/shared/errors'
import type { ClientId, UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { ClientRepository } from '../../ports/clientRepository'
import type { PhotoRepository } from '../../ports/photoRepository'

/**
 * What an account may read of its own clients' ceilings and use (`GET /api/me/limits`;
 * G2-16 / P3-17): for **each client the account belongs to**, what the operator allows, what
 * the client has used against it, and how close that is.
 *
 * ## Scoped by the caller's own roster, in the read
 *
 * The clients come from `membershipsForUser(userId)` and from nowhere else: there is no
 * client id in the input, so there is nothing a caller could name to see another client's
 * numbers. An account in no client gets an empty list, which is a success: the dashboard asks
 * every signed-in account, and "you have no limits" is an answer.
 *
 * ## The same numbers the write paths use
 *
 * The count of events is every status (`countEvents`, what `max_events` is judged against),
 * the period counter is the client's own and never decreases, and the byte figure is the
 * **admission** sum (`clientTotalBytes`, photographs of every status and the staged source of
 * each clip), which is what `max_total_bytes` is judged against in the write transaction. A
 * client reading "4.2 of 5 GB" is reading what the box will refuse on.
 *
 * Nothing here reads an event, a photograph or a name other than the client's own.
 */

export interface ClientLimits {
  readonly clientId: ClientId
  /** The client's own name: the one piece of text, and it is the caller's own. */
  readonly name: string
  /** What the caller is in this client. Only an owner reads its audit log. */
  readonly role: ClientRole
  /** Frozen by the operator: the client reads and exports, and writes are refused. */
  readonly suspended: boolean
  readonly ceilings: ClientCeilingsProps
  readonly usage: CeilingUsage
  readonly meters: readonly CeilingMeter[]
}

export interface GetClientLimitsInput {
  /** From the **session**, never from the request. */
  readonly userId: UserId
}

export interface GetClientLimitsDeps {
  readonly clients: Pick<ClientRepository, 'membershipsForUser' | 'findById' | 'countEvents'>
  readonly photos: Pick<PhotoRepository, 'clientTotalBytes'>
}

export type GetClientLimits = (
  input: GetClientLimitsInput,
) => Promise<Result<readonly ClientLimits[], DomainError>>

export const makeGetClientLimits =
  ({ clients, photos }: GetClientLimitsDeps): GetClientLimits =>
  async ({ userId }) => {
    const limits: ClientLimits[] = []
    for (const membership of await clients.membershipsForUser(userId)) {
      const client = await clients.findById(membership.clientId)
      // A membership cannot outlive its client (`ON DELETE CASCADE`), so this is a race with a
      // deletion: the client is gone and so are its limits.
      if (client === null) continue

      const usage: CeilingUsage = {
        events: await clients.countEvents(client.id),
        eventsCreatedInPeriod: client.eventsCreatedInPeriod,
        usedBytes: await photos.clientTotalBytes(client.id),
      }
      limits.push({
        clientId: client.id,
        name: client.name.value,
        role: membership.role,
        suspended: client.isSuspended(),
        ceilings: client.ceilings.toProps(),
        usage,
        meters: ceilingMeters(client.ceilings, usage),
      })
    }
    return ok(limits)
  }
