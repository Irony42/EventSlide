import { DomainError } from '../../../domain/shared/errors'
import type { ClientId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ClientPage, ClientRepository } from '../../ports/clientRepository'

/**
 * The operator's list of clients, newest first, a page at a time (roadmap §10.4). An
 * operator's act on the box, gated by `requireOperator` at the HTTP layer (G2-14); see
 * {@link makeCreateClient} for why there is no actor here.
 *
 * The page size is validated here rather than trusted to the adapter: it is bound into a
 * `LIMIT` one past what is asked for, so a caller who could pass `Infinity` or a million
 * would be choosing how much of the table one request reads, and a zero or a negative
 * would be answered differently by SQLite (`LIMIT -1` reads everything) and by the fake.
 */

export const DEFAULT_CLIENT_PAGE_SIZE = 50
export const MAX_CLIENT_PAGE_SIZE = 200

export interface ListClientsInput {
  /** The cursor a previous page returned as `next`; absent for the first page. */
  readonly after?: ClientId
  readonly limit?: number
}

export interface ListClientsDeps {
  readonly clients: ClientRepository
}

export type ListClients = (input: ListClientsInput) => Promise<Result<ClientPage, DomainError>>

export const makeListClients =
  ({ clients }: ListClientsDeps): ListClients =>
  async ({ after, limit = DEFAULT_CLIENT_PAGE_SIZE }) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CLIENT_PAGE_SIZE) {
      return err(DomainError.invalid('client.pageLimitInvalid', { max: MAX_CLIENT_PAGE_SIZE }))
    }

    return ok(await clients.list({ ...(after === undefined ? {} : { after }), limit }))
  }
