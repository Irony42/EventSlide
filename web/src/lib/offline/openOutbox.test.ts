import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbOutbox, deleteOutboxDb } from './indexedDbOutbox'
import { MemoryOutbox } from './memoryOutbox'
import { openOutbox } from './openOutbox'

/**
 * Which store a device actually gets.
 *
 * The fallback is not a nicety: Firefox in private browsing rejects the open outright,
 * and an upload screen that threw because a database would not open would be a far
 * worse outcome than a queue that forgets when the tab closes.
 */

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  await deleteOutboxDb()
})

describe('openOutbox', () => {
  it('uses the database when the browser has one', async () => {
    const store = await openOutbox()

    expect(store).toBeInstanceOf(IndexedDbOutbox)
    store.close()
  })

  it('falls back to memory rather than failing the upload screen', async () => {
    vi.spyOn(IndexedDbOutbox, 'open').mockRejectedValue(new Error('private browsing'))

    const store = await openOutbox()

    expect(store).toBeInstanceOf(MemoryOutbox)
  })
})
