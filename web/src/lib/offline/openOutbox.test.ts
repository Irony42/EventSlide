import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbOutbox, deleteOutboxDb } from './indexedDbOutbox'
import { MemoryOutbox } from './memoryOutbox'
import { forgetMemoryFallback, openOutbox } from './openOutbox'

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
  forgetMemoryFallback()
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

  describe('when the browser has no usable database (BUG-17)', () => {
    beforeEach(() => {
      vi.spyOn(IndexedDbOutbox, 'open').mockRejectedValue(new Error('private browsing'))
    })

    it('hands every open the same memory store, so the queue outlives the screen', async () => {
      const first = await openOutbox()
      const second = await openOutbox()

      expect(second).toBe(first)
    })

    it('keeps the photos of a guest who leaves the upload screen offline and comes back', async () => {
      const screen = await openOutbox()
      const { entry } = await screen.add(
        {
          slug: 'gala',
          bytes: new Uint8Array([0xff, 0xd8, 0xff]).buffer,
          fileName: 'confettis.jpg',
          fileType: 'image/jpeg',
          caption: null,
          missionId: null,
        },
        1_760_000_000_000,
      )

      screen.close() // what `useOutbox` does when the guest taps the feed link
      const backOnTheScreen = await openOutbox()

      expect((await backOnTheScreen.list('gala')).map((held) => held.id)).toEqual([entry.id])
    })
  })
})
