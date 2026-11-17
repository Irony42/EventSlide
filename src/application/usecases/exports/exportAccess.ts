import { exportAllowed } from '../../../domain/clients/exportAllowed'
import type { Event } from '../../../domain/events/event'
import type { DomainError } from '../../../domain/shared/errors'
import type { Result } from '../../../domain/shared/result'
import type { ClientRepository } from '../../ports/clientRepository'

/**
 * May a member of this event take its album out? **One call for every path that hands the album
 * over**: the streamed ZIP (`exportAlbum`) and the archive prepared on the box (request, state,
 * download, and the build itself), so that two of them cannot come to different answers (spec 22,
 * rule 8).
 *
 * The client is read only when it can change the answer, a suspended client's event: an event with
 * no client, or whose client is not suspended, costs no read. The rule itself is `exportAllowed`.
 */
export const checkExportAccess = async (
  clients: Pick<ClientRepository, 'findById'>,
  event: Event,
): Promise<Result<void, DomainError>> => {
  const client =
    event.isClientSuspended() && event.clientId !== null
      ? await clients.findById(event.clientId)
      : null
  return exportAllowed(event, client)
}
