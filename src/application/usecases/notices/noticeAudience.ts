import type { Client } from '../../../domain/clients/client'
import type { Event } from '../../../domain/events/event'
import type { ClientRepository } from '../../ports/clientRepository'

/**
 * **May the box write about this event?** (spec 32: one answer for every notice of the event family.)
 *
 * Not when the operator took the event down, when its client is suspended (read from the event **and** from the client: a
 * listing of events does not carry the suspension, a lookup of one does) or when the client is being closed (an offboarding).
 * Anything else may be written about, and a caller that must also leave out an archived event says so itself.
 *
 * Returns the event's client (`null` for an event that has none) when it may, and `undefined` when it may not, so the caller
 * reads the client once and reuses it (the mail's language).
 */
export const clientToWriteAbout = async (
  clients: Pick<ClientRepository, 'findById'>,
  event: Event,
): Promise<Client | null | undefined> => {
  if (event.isTakenDown() || event.isClientSuspended()) return undefined
  const client = event.clientId === null ? null : await clients.findById(event.clientId)
  return client?.isSuspended() === true || client?.isOffboarding() === true ? undefined : client
}
