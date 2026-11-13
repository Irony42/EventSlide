import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IndexedDbOutbox } from './indexedDbOutbox'
import { isOfflineQueueEnabled, resolveOfflineQueue } from './killSwitch'
import { OUTBOX_DB_NAME } from './names'
import { removeUploadWorker } from './serviceWorker'

/**
 * The switch that has to work on a phone already carrying a bad worker.
 *
 * Every case below is about one property: the default is on, "off" persists, and a
 * plain join link never resets a decision somebody made deliberately — because the
 * thing that makes a kill switch useless is a guest undoing it by scanning the QR code
 * again.
 */

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveOfflineQueue', () => {
  it('is on for a guest who has never been told otherwise', () => {
    expect(resolveOfflineQueue('')).toBe(true)
  })

  it('turns off on ?offline=off and stays off afterwards', () => {
    expect(resolveOfflineQueue('?offline=off')).toBe(false)
    // The guest does not have to keep the query string: the host typed it once on a
    // phone that was misbehaving, and it has to survive the next navigation.
    expect(isOfflineQueueEnabled()).toBe(false)
    expect(resolveOfflineQueue('')).toBe(false)
  })

  it('turns back on on ?offline=on', () => {
    resolveOfflineQueue('?offline=off')

    expect(resolveOfflineQueue('?offline=on')).toBe(true)
    expect(isOfflineQueueEnabled()).toBe(true)
  })

  it('leaves a deliberate decision alone when the URL says nothing about it', () => {
    // A join link carries a code, not a policy. If an ordinary navigation reset this,
    // the switch would last exactly until the guest scanned the QR code again.
    resolveOfflineQueue('?offline=off')

    expect(resolveOfflineQueue('?code=H7K2QM')).toBe(false)
  })

  it('ignores a value it does not recognise', () => {
    resolveOfflineQueue('?offline=off')

    expect(resolveOfflineQueue('?offline=maybe')).toBe(false)
  })

  it('stays on when the browser refuses to read storage at all', () => {
    // Safari in private browsing throws on access. Defaulting to off there would
    // silently disable the feature for a whole class of guests.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })

    expect(isOfflineQueueEnabled()).toBe(true)
  })

  it('still governs this page load when the decision cannot be written down', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })

    expect(resolveOfflineQueue('?offline=off')).toBe(false)
  })
})

/**
 * What turning the layer off does to the photos a guest is still waiting to send (SEC-06).
 *
 * A join link is forwarded in group chats, so `?offline=off` reaches phones whose owners never
 * typed it. The switch still turns the worker, the caches and the queue off; it no longer takes a
 * photo with it. Driven through the real store over `fake-indexeddb`, in the order `main.tsx`
 * runs it: resolve the URL, then remove the worker.
 */
describe('the switch arriving by URL, with photos waiting', () => {
  const aPhoto = (slug = 'camille-et-sacha') => ({
    slug,
    bytes: new ArrayBuffer(3),
    fileName: 'confettis.jpg',
    fileType: 'image/jpeg',
    caption: null,
    missionId: null,
  })

  const heldSlugs = async (): Promise<readonly string[]> => {
    const store = await IndexedDbOutbox.open()
    try {
      return await store.slugs()
    } finally {
      store.close()
    }
  }

  const arrivesBy = async (search: string): Promise<void> => {
    if (!resolveOfflineQueue(search)) await removeUploadWorker()
  }

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('keeps photos still waiting when the switch arrives by URL', async () => {
    const store = await IndexedDbOutbox.open()
    await store.add(aPhoto(), Date.now())
    store.close()

    await arrivesBy('?offline=off')

    expect(isOfflineQueueEnabled()).toBe(false)
    expect(await heldSlugs()).toEqual(['camille-et-sacha'])
  })

  it('keeps them for every event the device holds, not only the one in the URL', async () => {
    const store = await IndexedDbOutbox.open()
    await store.add(aPhoto('a'), Date.now())
    await store.add(aPhoto('b'), Date.now())
    store.close()

    await arrivesBy('?offline=off')

    expect([...(await heldSlugs())].sort()).toEqual(['a', 'b'])
  })

  it('deletes the store as before when nothing is waiting', async () => {
    const store = await IndexedDbOutbox.open()
    await store.add(aPhoto(), Date.now())
    await store.remove((await store.list('camille-et-sacha'))[0]?.id ?? '')
    store.close()

    await arrivesBy('?offline=off')

    expect((await indexedDB.databases()).map((db) => db.name)).not.toContain(OUTBOX_DB_NAME)
  })

  it('still switches off when the store cannot be opened', async () => {
    // The reason the switch exists: if the outbox itself is what is broken, "off" has to work.
    ;(await IndexedDbOutbox.open()).close()
    vi.spyOn(IndexedDbOutbox, 'open').mockRejectedValue(new Error('the database is corrupt'))

    await expect(arrivesBy('?offline=off')).resolves.toBeUndefined()

    expect(isOfflineQueueEnabled()).toBe(false)
    expect((await indexedDB.databases()).map((db) => db.name)).not.toContain(OUTBOX_DB_NAME)
  })
})
