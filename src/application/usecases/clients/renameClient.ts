import type { Client } from '../../../domain/clients/client'
import { DomainError } from '../../../domain/shared/errors'
import type { ClientId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ClientRepository } from '../../ports/clientRepository'

/**
 * Renames a client. An operator's act on the box, gated by `requireOperator` at the HTTP
 * layer (G2-14); see {@link makeCreateClient} for why there is no actor here.
 */

export interface RenameClientInput {
  readonly clientId: ClientId
  readonly name: string
}

export interface RenameClientDeps {
  readonly clients: ClientRepository
}

export type RenameClient = (input: RenameClientInput) => Promise<Result<Client, DomainError>>

export const makeRenameClient =
  ({ clients }: RenameClientDeps): RenameClient =>
  async ({ clientId, name }) => {
    const client = await clients.findById(clientId)
    if (client === null) return err(DomainError.notFound('client.notFound'))

    const renamed = client.rename(name)
    if (!renamed.ok) return renamed

    await clients.save(renamed.value)
    return ok(renamed.value)
  }
