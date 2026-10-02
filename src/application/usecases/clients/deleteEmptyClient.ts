import { DomainError } from '../../../domain/shared/errors'
import type { ClientId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ClientRepository } from '../../ports/clientRepository'

/**
 * Deletes a client that has nothing attached to it: no member and no event.
 *
 * Refusing a client that still owns something is the rule, and it has two layers on
 * purpose. `ClientRepository.deleteIfEmpty` checks emptiness **atomically with** the
 * delete, so a member or an event created between a check and a delete cannot be lost;
 * and `events.client_id` is `ON DELETE RESTRICT`, so even a caller that bypassed this
 * use case could not take an event's photographs with its client.
 *
 * `findById` runs first so that "no such client" and "not empty" are different answers
 * (404 and 409). The race this leaves — a client deleted by somebody else between the two
 * calls reads as `client.notEmpty` — is harmless: the rule that matters, never deleting a
 * non-empty client, is the repository's and is atomic.
 *
 * An operator's act on the box, gated by `requireOperator` at the HTTP layer (G2-14); see
 * {@link makeCreateClient} for why there is no actor here.
 */

export interface DeleteEmptyClientInput {
  readonly clientId: ClientId
}

export interface DeleteEmptyClientDeps {
  readonly clients: ClientRepository
}

export type DeleteEmptyClient = (
  input: DeleteEmptyClientInput,
) => Promise<Result<void, DomainError>>

export const makeDeleteEmptyClient =
  ({ clients }: DeleteEmptyClientDeps): DeleteEmptyClient =>
  async ({ clientId }) => {
    if ((await clients.findById(clientId)) === null) {
      return err(DomainError.notFound('client.notFound'))
    }

    if (!(await clients.deleteIfEmpty(clientId))) {
      return err(DomainError.conflict('client.notEmpty'))
    }
    return ok(undefined)
  }
