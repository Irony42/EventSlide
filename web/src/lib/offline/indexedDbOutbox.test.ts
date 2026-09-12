import 'fake-indexeddb/auto'
import { afterEach, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbOutbox, deleteOutboxDb } from './indexedDbOutbox'
import { outboxStoreContract } from './testing/outboxStoreContract'

/**
 * The real adapter, against a real IndexedDB implementation.
 *
 * `fake-indexeddb` rather than a hand-written double, on purpose. What this suite has
 * to catch is the adapter misusing the API — a transaction never awaited, a claim that
 * is two operations instead of one, an index queried with the wrong key range — and a
 * double written from the same misunderstanding would agree with every one of them.
 * jsdom implements no IndexedDB at all, so there is no third option.
 *
 * A fresh factory per test, because a database outlives a single `it` otherwise and the
 * cap case would start with forty entries already in it.
 */

const opened: IndexedDbOutbox[] = []

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

afterEach(async () => {
  for (const store of opened.splice(0)) store.close()
  await deleteOutboxDb()
})

outboxStoreContract('indexeddb', async () => {
  const store = await IndexedDbOutbox.open()
  opened.push(store)
  return store
})
