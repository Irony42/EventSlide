import type { ClientCeilings } from '../../../domain/clients/clientCeilings'
import type { Event } from '../../../domain/events/event'
import type {
  ClientByteLimit,
  ClientEventContext,
  ClientRepository,
} from '../../ports/clientRepository'

/**
 * The client an event answers to and the ceilings in force, or `null` for an event that
 * has none — read the one way every write path reads it (roadmap §10.5).
 *
 * **An event with no client never touches the clients table.** `event.clientId` is on the
 * aggregate already, so the question "does this event have ceilings" is answered without a
 * query, and a box with no clients — every self-hosted installation — asks nothing it did
 * not ask before there were any. That is the whole of "ceilings are enforced from the data,
 * not from the `SITE_ADMIN` switch": the switch is not consulted, and the data is not read
 * unless it can say something.
 *
 * A pure function over two arguments rather than a method on the port, because the port's
 * `contextForEvent` is the lookup and this is the decision not to make it.
 */
export const clientContextOf = async (
  clients: Pick<ClientRepository, 'contextForEvent'>,
  event: Event,
): Promise<ClientEventContext | null> =>
  event.clientId === null ? null : clients.contextForEvent(event.id)

/**
 * What an admission carries into its write transaction for the client's `max_total_bytes`:
 * the client and the ceiling, or `null` — no client, or a client with no such ceiling —
 * which is also what tells the repository not to read the second sum at all.
 */
export const clientBytesOf = (context: ClientEventContext | null): ClientByteLimit | null => {
  const maxBytes = context?.ceilings.maxTotalBytes ?? null
  return context === null || maxBytes === null ? null : { clientId: context.clientId, maxBytes }
}

/**
 * Just the ceilings of the event's client — `null` for an event with no client — for a caller
 * that does not need the client's id or its other facts. The same lookup as
 * {@link clientContextOf}, so an event with no client still costs no read.
 */
export const ceilingsOf = async (
  clients: Pick<ClientRepository, 'contextForEvent'>,
  event: Event,
): Promise<ClientCeilings | null> => (await clientContextOf(clients, event))?.ceilings ?? null
