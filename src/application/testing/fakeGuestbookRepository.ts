import { GuestbookEntry } from '../../domain/guestbook/guestbookEntry'
import { DUPLICATE_WINDOW_MS, guestbookRefusalFor } from '../../domain/guestbook/guestbookLimits'
import type { EventId, GuestId, GuestbookEntryId } from '../../domain/shared/ids'
import type { GuestbookAdmission, GuestbookRepository } from '../ports/guestbookRepository'
import { compareIds } from './ordering'

/**
 * In-memory `GuestbookRepository`, behaving the way the SQLite adapter must.
 *
 * - **Rows are keyed by `${eventId}:${entryId}`**, so a cross-event read genuinely misses.
 * - **`admit` runs the same decision** (`guestbookRefusalFor`, the duplicate window) the adapter
 *   runs inside its transaction, in the same order.
 * - **A taken-down row is invisible to every read** and visible to the two counts that must see
 *   it, exactly as the real `taken_down_at IS NULL` filters make it.
 */

const key = (eventId: EventId, entryId: GuestbookEntryId): string => `${eventId}:${entryId}`

/** Newest first, with the id breaking ties the way the `ORDER BY created_at DESC, id DESC` does. */
const newestFirst = (left: GuestbookEntry, right: GuestbookEntry): number =>
  right.createdAt.getTime() - left.createdAt.getTime() || compareIds(right.id, left.id)

export class FakeGuestbookRepository implements GuestbookRepository {
  private readonly rows = new Map<string, GuestbookEntry>()

  /** Seed fixtures, with no ceiling applied. */
  seed(...entries: readonly GuestbookEntry[]): this {
    for (const entry of entries) this.rows.set(key(entry.eventId, entry.id), entry)
    return this
  }

  /**
   * Test infrastructure for the operator's takedown, which only a later change writes through the
   * port: the instant is set directly, as `UPDATE ... SET taken_down_at` does in the SQLite suite.
   */
  takeDown(eventId: EventId, entryId: GuestbookEntryId, at: Date): void {
    const row = this.rows.get(key(eventId, entryId))
    if (row === undefined) return
    this.rows.set(
      key(eventId, entryId),
      GuestbookEntry.restore({ ...row.toProps(), takenDownAt: at }),
    )
  }

  /** Every row of an event, taken-down ones included, for a test to assert on. */
  all(eventId: EventId): readonly GuestbookEntry[] {
    return [...this.rows.values()].filter((row) => row.eventId === eventId)
  }

  private visibleOf(eventId: EventId): GuestbookEntry[] {
    return this.all(eventId).filter((row) => row.takenDownAt === null)
  }

  async findById(eventId: EventId, entryId: GuestbookEntryId): Promise<GuestbookEntry | null> {
    const row = this.rows.get(key(eventId, entryId))
    return row === undefined || row.takenDownAt !== null ? null : row
  }

  async admit(entry: GuestbookEntry): Promise<GuestbookAdmission> {
    const { eventId, guestId } = entry
    const duplicate = this.visibleOf(eventId).find(
      (row) =>
        row.guestId === guestId &&
        row.text.equals(entry.text) &&
        entry.createdAt.getTime() - row.createdAt.getTime() < DUPLICATE_WINDOW_MS,
    )
    if (duplicate !== undefined) return { kind: 'duplicate', entry: duplicate }

    const refusal = guestbookRefusalFor({
      heldByGuest: await this.countByGuest(eventId, guestId),
      openInEvent: await this.countOpenByEvent(eventId),
    })
    if (refusal !== null) return { kind: 'refused', refusal }

    this.rows.set(key(eventId, entry.id), entry)
    return { kind: 'added', entry }
  }

  async save(entry: GuestbookEntry): Promise<void> {
    const current = await this.findById(entry.eventId, entry.id)
    if (current === null) return
    this.rows.set(key(entry.eventId, entry.id), entry)
  }

  async listByGuest(
    eventId: EventId,
    guestId: GuestId,
    limit: number,
  ): Promise<readonly GuestbookEntry[]> {
    return this.visibleOf(eventId)
      .filter((row) => row.guestId === guestId)
      .sort(newestFirst)
      .slice(0, limit)
  }

  async countByGuest(eventId: EventId, guestId: GuestId): Promise<number> {
    return this.all(eventId).filter((row) => row.guestId === guestId).length
  }

  async countOpenByEvent(eventId: EventId): Promise<number> {
    return this.visibleOf(eventId).filter((row) => row.status !== 'rejected').length
  }

  async delete(eventId: EventId, entryId: GuestbookEntryId): Promise<void> {
    this.rows.delete(key(eventId, entryId))
  }

  async deleteByGuest(eventId: EventId, guestId: GuestId): Promise<number> {
    const doomed = this.visibleOf(eventId).filter((row) => row.guestId === guestId)
    for (const row of doomed) this.rows.delete(key(eventId, row.id))
    return doomed.length
  }

  async countTakenDownBy(eventId: EventId, guestId: GuestId): Promise<number> {
    return this.all(eventId).filter((row) => row.guestId === guestId && row.takenDownAt !== null)
      .length
  }
}
