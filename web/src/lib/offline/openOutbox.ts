import { IndexedDbOutbox } from './indexedDbOutbox'
import { MemoryOutbox } from './memoryOutbox'
import type { OutboxStore } from './outbox'

/**
 * The store this device can actually use.
 *
 * IndexedDB where it works, memory where it does not — and it does not, in more places
 * than the feature list suggests: Firefox in private browsing rejects the open, some
 * embedded webviews expose the global and then fail, and a browser at its storage quota
 * refuses the write. A guest in any of those cases still gets a queue that survives a
 * dropped connection for the length of the tab, which is most of the value; what they
 * lose is the queue surviving the tab closing.
 *
 * Never rejects. An upload screen that threw because a database would not open would be
 * a far worse outcome than a queue that forgets.
 */
export const openOutbox = async (): Promise<OutboxStore> => {
  try {
    return await IndexedDbOutbox.open()
  } catch (cause) {
    console.warn('the outbox fell back to memory; photos will not survive this tab', cause)
    return new MemoryOutbox()
  }
}
