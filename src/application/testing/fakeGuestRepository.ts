import type { Guest } from '../../domain/guests/guest'
import type { EventId, GuestId } from '../../domain/shared/ids'
import type { GuestRepository } from '../ports/guestRepository'

/**
 * In-memory `GuestRepository`.
 *
 * Keyed by `${eventId}:${guestId}`, because a guest belongs to exactly one event by
 * construction: the device token issued at one wedding names a guest row that must not
 * resolve at the next. `findById(guestId)` does not exist in the port, and this key is
 * what makes the equivalent mistake fail a test rather than pass one.
 *
 * `photoCount` is stored here as given, which is the one place this double is
 * knowingly more generous than the schema: `guests` has no such column, so the adapter
 * derives the number from `photos.author_guest_id`. A fixture may therefore set a
 * count the adapter would recompute — the shared contract asserts nothing about it,
 * and a rule about the per-guest limit belongs against `countByAuthor`.
 */

/** Code-unit order, not locale order: an id sort must not depend on the host's ICU. */
const compareIds = (left: string, right: string): number =>
  Number(left > right) - Number(left < right)

/**
 * Most recently seen first, ties broken by id — `idx_guests_event_seen`. The host's
 * guest list is "who is here", so presence orders it, not join order.
 */
const mostRecentlySeenFirst = (left: Guest, right: Guest): number =>
  right.lastSeenAt.getTime() - left.lastSeenAt.getTime() || compareIds(left.id, right.id)

const key = (eventId: EventId, guestId: GuestId): string => `${eventId}:${guestId}`

export class FakeGuestRepository implements GuestRepository {
  private readonly rows = new Map<string, Guest>()

  seed(...guests: readonly Guest[]): this {
    for (const guest of guests) this.rows.set(key(guest.eventId, guest.id), guest)
    return this
  }

  async findById(eventId: EventId, guestId: GuestId): Promise<Guest | null> {
    return this.rows.get(key(eventId, guestId)) ?? null
  }

  async list(eventId: EventId): Promise<readonly Guest[]> {
    return [...this.rows.values()]
      .filter((guest) => guest.eventId === eventId)
      .sort(mostRecentlySeenFirst)
  }

  /**
   * "Who is at the party right now."
   *
   * Inclusive of the boundary, and revoked guests are excluded: a host who has just
   * cut off a disruptive guest must not still see them in the count, or the button
   * they pressed looks broken.
   */
  async countActive(eventId: EventId, since: Date): Promise<number> {
    return [...this.rows.values()].filter(
      (guest) =>
        guest.eventId === eventId &&
        guest.isActive() &&
        guest.lastSeenAt.getTime() >= since.getTime(),
    ).length
  }

  async save(guest: Guest): Promise<void> {
    this.rows.set(key(guest.eventId, guest.id), guest)
  }

  /** Idempotent: deleting an already-deleted guest is not an error. */
  async delete(eventId: EventId, guestId: GuestId): Promise<void> {
    this.rows.delete(key(eventId, guestId))
  }
}
