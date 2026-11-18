import { IndexedDbOutbox } from './indexedDbOutbox'
import { MemoryOutbox } from './memoryOutbox'
import { VOICE_DB_NAME } from './names'
import { VOICE_POLICY } from './voicePolicy'
import type { OutboxStore } from './outbox'

/**
 * The store the guest's voice recordings wait in (spec 25): IndexedDB under its own name, memory
 * where the browser refuses a database. Never rejects, for the reason `openOutbox` gives.
 *
 * The memory fallback is the page's one for its whole life, as the photo queue's is, so a guest who
 * leaves the screen and comes back finds a recording that has not been sent yet.
 */
let memoryFallback: MemoryOutbox | null = null

/** Drops the page's memory store. For tests, which share a module instance and must not share a queue. */
export const forgetVoiceMemoryFallback = (): void => {
  memoryFallback = null
}

export const openVoiceOutbox = async (): Promise<OutboxStore> => {
  try {
    return await IndexedDbOutbox.open({
      dbName: VOICE_DB_NAME,
      maxEntriesPerEvent: VOICE_POLICY.maxEntriesPerEvent,
    })
  } catch (cause) {
    console.warn('the voice queue fell back to memory; recordings will not survive this tab', cause)
    memoryFallback ??= new MemoryOutbox(VOICE_POLICY)
    return memoryFallback
  }
}
