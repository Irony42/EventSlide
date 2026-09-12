import { newOutboxId } from './outboxId'
import { MAX_ENTRIES_PER_EVENT } from './outboxPolicy'
import type { NewOutboxEntry, OutboxAddition, OutboxEntry, OutboxStore } from './outbox'

/**
 * A real in-memory `OutboxStore`, not a stub.
 *
 * It enforces what the IndexedDB adapter enforces — per-event scoping, insertion
 * order, the entry cap, an exclusive claim — so a test driven by it exercises the
 * same rules production does. The two are held together by the shared contract suite
 * in `testing/outboxStoreContract.ts`; that is the whole reason this is a behaving fake and
 * not a `vi.fn()`.
 *
 * It is also the production fallback. A browser in private mode can refuse to open a
 * database at all, and a guest whose phone did so should still get a queue that works
 * for the length of the tab rather than an upload screen that throws.
 */
export class MemoryOutbox implements OutboxStore {
  private entries: OutboxEntry[] = []

  async add(entry: NewOutboxEntry, now: number): Promise<OutboxAddition> {
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
    this.entries.push(stored)
    return { entry: stored, evicted: this.evictOverflow(entry.slug) }
  }

  async list(slug: string): Promise<readonly OutboxEntry[]> {
    // Sorted, not merely filtered. The adapter cannot return insertion order — an
    // IndexedDB index orders by its key — so it sorts by arrival, and a fake that
    // disagreed would hide an ordering regression from every test that drives it.
    return this.entries
      .filter((candidate) => candidate.slug === slug)
      .sort((left, right) => left.enqueuedAt - right.enqueuedAt)
  }

  async slugs(): Promise<readonly string[]> {
    return [...new Set(this.entries.map((candidate) => candidate.slug))]
  }

  async claim(id: string, now: number, leaseMs: number): Promise<OutboxEntry | null> {
    const index = this.entries.findIndex((candidate) => candidate.id === id)
    const current = this.entries[index]
    if (current === undefined) return null
    if (current.claimedAt !== null && now - current.claimedAt < leaseMs) return null
    const claimed: OutboxEntry = { ...current, claimedAt: now }
    this.entries[index] = claimed
    return claimed
  }

  async release(id: string, now: number): Promise<void> {
    const index = this.entries.findIndex((candidate) => candidate.id === id)
    const current = this.entries[index]
    if (current === undefined) return
    // The lease is given back, not renewed: `claimedAt` says "a drain holds this", and
    // an entry nobody is sending must not look held.
    this.entries[index] = {
      ...current,
      claimedAt: null,
      lastAttemptAt: now,
      attempts: current.attempts + 1,
    }
  }

  async remove(id: string): Promise<void> {
    this.entries = this.entries.filter((candidate) => candidate.id !== id)
  }

  async clear(slug: string): Promise<void> {
    this.entries = this.entries.filter((candidate) => candidate.slug !== slug)
  }

  close(): void {
    this.entries = []
  }

  /** Oldest first, matching the adapter: the cap drops what has waited longest. */
  private evictOverflow(slug: string): readonly string[] {
    const mine = this.entries
      .filter((candidate) => candidate.slug === slug)
      .sort((left, right) => left.enqueuedAt - right.enqueuedAt)
    const excess = mine.length - MAX_ENTRIES_PER_EVENT
    if (excess <= 0) return []
    const doomed = new Set(mine.slice(0, excess).map((candidate) => candidate.id))
    this.entries = this.entries.filter((candidate) => !doomed.has(candidate.id))
    return [...doomed]
  }
}
