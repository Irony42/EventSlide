import { openOutbox } from './openOutbox'

/**
 * Forgets every photo this device is still holding for one event.
 *
 * What "Ce n'est pas votre soirée ?" does to the queue (QUAL-06): an entry carries no guest identity,
 * only the event it belongs to, and whatever device-token cookie exists for that event when it is
 * finally sent decides whose name it appears under. On a phone that was lent, the earlier person's
 * pending photos would otherwise go out under the next guest's. The service worker drains the same
 * IndexedDB store by event, so deleting the entries here is also what stops it.
 *
 * Never rejects: the caller is a button on the way out of the event, and there is nothing it could
 * do about a store that would not open.
 */
export const clearOutboxFor = async (slug: string): Promise<void> => {
  try {
    const store = await openOutbox()
    try {
      await store.clear(slug)
    } finally {
      store.close()
    }
  } catch (cause) {
    console.warn('the pending photos of this event could not be cleared', cause)
  }
}
