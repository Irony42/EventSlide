import { newOutboxId } from './outboxId'
import { MAX_ENTRIES_PER_EVENT } from './outboxPolicy'
import type { NewOutboxEntry, OutboxEntry, OutboxStore } from './outbox'

/**
 * The `OutboxStore` that survives the tab closing.
 *
 * Hand-rolled over the raw IndexedDB API rather than through a wrapper library,
 * because this module is imported by the service worker as well as by the page and
 * the repository ships no CDN and no runtime dependency on the guest surface. It is
 * roughly a hundred lines; a wrapper would be a build-time decision paid for on every
 * guest's phone.
 *
 * Blobs go in directly. IndexedDB stores them by structured clone, so the bytes never
 * pass through base64 — which would inflate a 2 MB photo to 2.7 MB of string in a
 * storage area the browser is entitled to evict under pressure.
 */

export const DB_NAME = 'eventslide-outbox'
export const DB_VERSION = 1
const STORE = 'entries'
const BY_SLUG = 'bySlug'

/**
 * Whether this runtime has IndexedDB at all.
 *
 * Firefox in private browsing and a handful of embedded webviews expose the global and
 * then fail the open, so callers must handle a rejected open too — this only spares
 * them the common case.
 */
export const hasIndexedDb = (): boolean => typeof indexedDB !== 'undefined' && indexedDB !== null

const promisify = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })

export const openOutboxDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error('this browser has no IndexedDB'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (db.objectStoreNames.contains(STORE)) return
      const store = db.createObjectStore(STORE, { keyPath: 'id' })
      // Every read is scoped by event, exactly as every photo query on the server is.
      // A store that could hand back another event's photo is the same bug on the
      // other side of the wire.
      store.createIndex(BY_SLUG, 'slug', { unique: false })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the outbox could not be opened'))
    request.onblocked = () =>
      reject(new Error('the outbox is held open by another tab running an older build'))
  })

/** Resolves when the transaction commits, so a caller can await a write. */
const committed = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('the outbox transaction was aborted'))
    tx.onerror = () => reject(tx.error ?? new Error('the outbox transaction failed'))
  })

export class IndexedDbOutbox implements OutboxStore {
  constructor(private readonly db: IDBDatabase) {}

  static async open(): Promise<IndexedDbOutbox> {
    return new IndexedDbOutbox(await openOutboxDb())
  }

  async add(entry: NewOutboxEntry, now: number): Promise<OutboxEntry> {
    const stored: OutboxEntry = {
      id: newOutboxId(),
      slug: entry.slug,
      bytes: entry.bytes,
      fileName: entry.fileName,
      fileType: entry.fileType,
      caption: entry.caption,
      enqueuedAt: now,
      attempts: 0,
      lastAttemptAt: null,
      claimedAt: null,
      csrfToken: entry.csrfToken,
    }

    const tx = this.db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).add(stored)
    await committed(tx)

    await this.evictOverflow(entry.slug)
    return stored
  }

  async list(slug: string): Promise<readonly OutboxEntry[]> {
    const tx = this.db.transaction(STORE, 'readonly')
    const index = tx.objectStore(STORE).index(BY_SLUG)
    const rows = await promisify<OutboxEntry[]>(index.getAll(IDBKeyRange.only(slug)))
    await committed(tx)
    // The index orders by slug, not by arrival, so the order comes from the timestamp
    // rather than from the store. Oldest first: a guest's first photo is the one they
    // most expect to see arrive.
    return [...rows].sort((left, right) => left.enqueuedAt - right.enqueuedAt)
  }

  async slugs(): Promise<readonly string[]> {
    const tx = this.db.transaction(STORE, 'readonly')
    // The outbox holds tens of entries at most, which is what makes reading them all
    // acceptable here and would not be on the server. There is no index on a set of
    // distinct values in IndexedDB, so the set is built from the rows.
    const rows = await promisify<OutboxEntry[]>(tx.objectStore(STORE).getAll())
    await committed(tx)
    return [...new Set(rows.map((row) => row.slug))]
  }

  /**
   * Read and write in one transaction, which is what makes this a claim.
   *
   * A `get` followed by a separate `put` would let the page and a Background Sync both
   * see `claimedAt: null` and both start uploading the same photo — the exact
   * duplicate the feature exists to avoid.
   */
  async claim(id: string, now: number, leaseMs: number): Promise<OutboxEntry | null> {
    const tx = this.db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const current = await promisify<OutboxEntry | undefined>(store.get(id))

    if (current === undefined) {
      await committed(tx)
      return null
    }
    if (current.claimedAt !== null && now - current.claimedAt < leaseMs) {
      await committed(tx)
      return null
    }

    const claimed: OutboxEntry = { ...current, claimedAt: now }
    store.put(claimed)
    await committed(tx)
    return claimed
  }

  async release(id: string, now: number): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const current = await promisify<OutboxEntry | undefined>(store.get(id))
    if (current !== undefined) {
      // The lease is given back, not renewed: `claimedAt` says "a drain holds this",
      // and an entry nobody is sending must not look held.
      store.put({
        ...current,
        claimedAt: null,
        lastAttemptAt: now,
        attempts: current.attempts + 1,
      })
    }
    await committed(tx)
  }

  async remove(id: string): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    await committed(tx)
  }

  async clear(slug: string): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const keys = await promisify<IDBValidKey[]>(
      store.index(BY_SLUG).getAllKeys(IDBKeyRange.only(slug)),
    )
    for (const key of keys) store.delete(key)
    await committed(tx)
  }

  close(): void {
    this.db.close()
  }

  /** Drops the oldest entries once one event holds more than the cap allows. */
  private async evictOverflow(slug: string): Promise<void> {
    const mine = await this.list(slug)
    const excess = mine.length - MAX_ENTRIES_PER_EVENT
    if (excess <= 0) return
    for (const entry of mine.slice(0, excess)) await this.remove(entry.id)
  }
}

/**
 * Deletes the whole database.
 *
 * The kill switch's teeth: turning the feature off has to take the stored photos with
 * it, or a guest carries a queue no code is left to drain.
 */
export const deleteOutboxDb = (): Promise<void> =>
  new Promise((resolve) => {
    if (!hasIndexedDb()) {
      resolve()
      return
    }
    const request = indexedDB.deleteDatabase(DB_NAME)
    // Resolved on every outcome on purpose: a deletion blocked by another tab must not
    // stop the page from loading, and the next load tries again.
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
