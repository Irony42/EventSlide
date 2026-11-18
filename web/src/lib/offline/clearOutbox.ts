import { openOutbox } from './openOutbox'
import { openVoiceOutbox } from './openVoiceOutbox'
import type { OutboxStore } from './outbox'

/**
 * Forgets every photo, and every voice recording, this device is still holding for one event.
 *
 * What "Ce n'est pas votre soirée ?" does to the queues (QUAL-06): an entry carries no guest identity,
 * only the event it belongs to, and whatever device-token cookie exists for that event when it is
 * finally sent decides whose name it appears under. On a phone that was lent, the earlier person's
 * pending photos would otherwise go out under the next guest's. The service worker drains the same
 * IndexedDB store by event, so deleting the entries here is also what stops it.
 *
 * The voice queue (spec 25) is its own database and is emptied here too, and by "Tout effacer"
 * (`useEraseEverything`): one that survived would bring back a message its author took back.
 *
 * Never rejects: the caller is a button on the way out of the event, and there is nothing it could
 * do about a store that would not open. Each queue is cleared on its own, so one that fails does
 * not leave the other holding.
 */
const clearOne = async (open: () => Promise<OutboxStore>, slug: string): Promise<void> => {
  try {
    const store = await open()
    try {
      await store.clear(slug)
    } finally {
      store.close()
    }
  } catch (cause) {
    console.warn('the pending uploads of this event could not be cleared', cause)
  }
}

export const clearOutboxFor = async (slug: string): Promise<void> => {
  await clearOne(openOutbox, slug)
  await clearOne(openVoiceOutbox, slug)
}

/** The voice queue alone, for the one caller that has already cleared the photo queue. */
export const clearVoiceOutboxFor = (slug: string): Promise<void> => clearOne(openVoiceOutbox, slug)
