import type { Client } from '../../../domain/clients/client'
import { ClientCeilings, type ClientCeilingsInput } from '../../../domain/clients/clientCeilings'
import { DomainError } from '../../../domain/shared/errors'
import type { ClientId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ClientRepository } from '../../ports/clientRepository'

/**
 * Changes what a client may do (roadmap §10.5). An operator's act on the box, gated by
 * `requireOperator` at the HTTP layer (G2-14); see {@link makeCreateClient} for why there
 * is no actor here.
 *
 * **A patch, not a replacement.** An omitted key keeps the client's current value and an
 * explicit `null` removes that ceiling, so an operator raising one number cannot
 * silently lift the other seven.
 *
 * **A renewal resets the per-period counter, and nothing else does.** When the patch
 * moves `periodStartedAt` the client's `eventsCreatedInPeriod` goes back to zero —
 * `Client.withCeilings` carries the rule — and an ordinary edit of any other ceiling
 * leaves it alone. The counter never decreases on its own, so "create, delete, recreate"
 * cannot walk around a per-period ceiling.
 *
 * The paid plan also asks this use case to write an audit entry `{before, after}` when
 * the period resets. `AuditLog` is a later item (roadmap §10.8, G2-06, which depends on
 * this one), so there is nothing to write to yet; that arrives with it.
 */

export interface SetClientCeilingsInput {
  readonly clientId: ClientId
  readonly ceilings: ClientCeilingsInput
}

export interface SetClientCeilingsDeps {
  readonly clients: ClientRepository
}

export type SetClientCeilings = (
  input: SetClientCeilingsInput,
) => Promise<Result<Client, DomainError>>

export const makeSetClientCeilings =
  ({ clients }: SetClientCeilingsDeps): SetClientCeilings =>
  async ({ clientId, ceilings }) => {
    const client = await clients.findById(clientId)
    if (client === null) return err(DomainError.notFound('client.notFound'))

    const next = ClientCeilings.create({ ...client.ceilings.toProps(), ...ceilings })
    if (!next.ok) return next

    const updated = client.withCeilings(next.value)
    await clients.save(updated)
    return ok(updated)
  }
