import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbOutbox, deleteOutboxDb } from './indexedDbOutbox'
import { MemoryOutbox } from './memoryOutbox'
import { OUTBOX_DB_NAME, VOICE_DB_NAME } from './names'
import { forgetMemoryFallback, openOutbox } from './openOutbox'
import { forgetVoiceMemoryFallback, openVoiceOutbox } from './openVoiceOutbox'
import { removeUploadWorker } from './serviceWorker'
import { clearOutboxFor } from './clearOutbox'
import { outboxStoreContract, anEntry, t } from './testing/outboxStoreContract'
import { MAX_ENTRIES_PER_EVENT } from './outboxPolicy'
import { VOICE_POLICY } from './voicePolicy'

/**
 * The voice queue is the outbox contract again, over its own database (spec 25, section 5).
 *
 * Its own database and not a second store in the photo one, for four reasons the spec gives and
 * which are pinned below as behaviour: the two never read each other's entries, the kill switch of
 * the worker never deletes the recordings, and "Tout effacer" empties both.
 */

const opened: IndexedDbOutbox[] = []

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  forgetMemoryFallback()
  forgetVoiceMemoryFallback()
})

afterEach(() => {
  for (const store of opened.splice(0)) store.close()
})

const openVoice = async (maxEntriesPerEvent: number = MAX_ENTRIES_PER_EVENT) => {
  const store = await IndexedDbOutbox.open({ dbName: VOICE_DB_NAME, maxEntriesPerEvent })
  opened.push(store)
  return store
}

// The same suite the photo queue runs, against the voice database and against the memory fallback
// the voice queue uses where a browser refuses to open one. The scenarios of the suite hold more
// than three entries, so the store they start from has room for them; the cap itself is its first
// test (`capped`), and the voice queue's three is pinned below.
outboxStoreContract(
  'voice, indexeddb',
  () => openVoice(),
  () => openVoice(),
  openVoice,
)
outboxStoreContract(
  'voice, memory',
  async () => new MemoryOutbox({ maxEntriesPerEvent: MAX_ENTRIES_PER_EVENT }),
  async (previous) => previous,
  async (maxEntriesPerEvent) => new MemoryOutbox({ maxEntriesPerEvent }),
)

describe('the voice database', () => {
  it('is not the photo database, so neither queue reads the other’s entries', async () => {
    const photos = await openOutbox()
    const voices = await openVoiceOutbox()
    await photos.add(anEntry({ fileName: 'confettis.jpg' }), t)
    await voices.add(anEntry({ fileName: 'message-vocal.webm', fileType: 'audio/webm' }), t)

    expect((await photos.list('camille-et-sacha')).map((held) => held.fileName)).toEqual([
      'confettis.jpg',
    ])
    expect((await voices.list('camille-et-sacha')).map((held) => held.fileName)).toEqual([
      'message-vocal.webm',
    ])
    expect(VOICE_DB_NAME).not.toBe(OUTBOX_DB_NAME)
    photos.close()
    voices.close()
  })

  it('holds three recordings to an event, and the photo queue still forty', async () => {
    const voices = await openVoiceOutbox()
    const photos = await openOutbox()
    expect(VOICE_POLICY.maxEntriesPerEvent).toBe(3)
    for (let index = 0; index < 4; index += 1) {
      await voices.add(anEntry({ fileName: `voix-${index}.webm` }), t + index)
      await photos.add(anEntry({ fileName: `photo-${index}.jpg` }), t + index)
    }

    expect(await voices.list('camille-et-sacha')).toHaveLength(3)
    expect(await photos.list('camille-et-sacha')).toHaveLength(4)
    photos.close()
    voices.close()
  })

  it('survives the kill switch of the worker, which deletes the photo database', async () => {
    // The switch arrives by URL and a join link is forwarded in group chats: it must never
    // destroy a recording the guest believes is queued.
    const voices = await openVoiceOutbox()
    await voices.add(anEntry({ fileName: 'message-vocal.webm' }), t)
    voices.close()

    await removeUploadWorker()

    const after = await openVoiceOutbox()
    expect((await after.list('camille-et-sacha')).map((held) => held.fileName)).toEqual([
      'message-vocal.webm',
    ])
    after.close()
    await deleteOutboxDb()
  })

  it('is emptied, with the photo queue, by leaving the event', async () => {
    // One that survived would bring back a message its author took back, in someone else's name.
    const photos = await openOutbox()
    const voices = await openVoiceOutbox()
    await photos.add(anEntry(), t)
    await voices.add(anEntry({ fileName: 'message-vocal.webm' }), t)
    await voices.add(anEntry({ slug: 'gala', fileName: 'autre.webm' }), t)
    photos.close()
    voices.close()

    await clearOutboxFor('camille-et-sacha')

    const afterPhotos = await openOutbox()
    const afterVoices = await openVoiceOutbox()
    expect(await afterPhotos.list('camille-et-sacha')).toHaveLength(0)
    expect(await afterVoices.list('camille-et-sacha')).toHaveLength(0)
    // …and only that event's.
    expect(await afterVoices.list('gala')).toHaveLength(1)
    afterPhotos.close()
    afterVoices.close()
  })
})
