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
 * lose is the queue surviving the tab closing. The memory store is shared by every open, so it also
 * survives the upload screen closing it.
 *
 * Never rejects. An upload screen that threw because a database would not open would be
 * a far worse outcome than a queue that forgets.
 */
/**
 * The page's one memory store, created the first time the database fails to open.
 *
 * A module-level singleton on purpose: the upload screen opens a store when it mounts and closes it
 * when it unmounts, and a guest who is offline with photos waiting and taps the feed link unmounts
 * it. A store per open would have taken those photos with the screen. One per page lifetime is what
 * "a queue that survives the length of the tab" means. It still dies with the tab, which no code
 * here can change, and a full reload empties it: only IndexedDB survives that.
 */
let memoryFallback: MemoryOutbox | null = null

/** Drops the page's memory store. For tests, which share a module instance and must not share a queue. */
export const forgetMemoryFallback = (): void => {
  memoryFallback = null
}

export const openOutbox = async (): Promise<OutboxStore> => {
  try {
    return await IndexedDbOutbox.open()
  } catch (cause) {
    console.warn('the outbox fell back to memory; photos will not survive this tab', cause)
    memoryFallback ??= new MemoryOutbox()
    return memoryFallback
  }
}
