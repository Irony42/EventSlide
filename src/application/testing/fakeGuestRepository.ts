import { Guest } from '../../domain/guests/guest'
import type { EventId, GuestId } from '../../domain/shared/ids'
import type { GuestRepository } from '../ports/guestRepository'
import { compareIds } from './ordering'

/**
 * In-memory `GuestRepository`.
 *
 * Keyed by `${eventId}:${guestId}`, because a guest belongs to exactly one event by
 * construction: the device token issued at one wedding names a guest row that must not
 * resolve at the next. `findById(guestId)` does not exist in the port, and this key is
 * what makes the equivalent mistake fail a test rather than pass one.
 *
 * `photoCount` is derived, never stored, exactly as in the adapter: `guests` has no such
 * column, and the number is a count of `photos.author_guest_id` within the guest's own
 * event. The fake is handed the photo fake (`new FakeGuestRepository(photos)`) to count in,
 * as `FakeEventRepository` is handed its neighbours; with none, no photo is known and every
 * count is 0. A count a saved guest carries is discarded, as `save` discards it on the way to
 * the table; a fixture that `seed`s one is refused, because a number the fake would not return
 * is a broken fixture.
 */

/**
 * The photographs a guest took, which is the one thing `photoCount` is derived from, and
 * which go when the guest does (`ON DELETE CASCADE`). `FakePhotoRepository` holds them.
 */
export interface GuestPhotoSource {
  authoredBy(eventId: EventId, guestId: GuestId): number
  deleteAuthoredBy(eventId: EventId, guestId: GuestId): void
}

/**
 * Most recently seen first, ties broken by id — `idx_guests_event_seen`. The host's
 * guest list is "who is here", so presence orders it, not join order.
 */
const mostRecentlySeenFirst = (left: Guest, right: Guest): number =>
  right.lastSeenAt.getTime() - left.lastSeenAt.getTime() || compareIds(left.id, right.id)

const key = (eventId: EventId, guestId: GuestId): string => `${eventId}:${guestId}`

export class FakeGuestRepository implements GuestRepository {
  private readonly rows = new Map<string, Guest>()

  constructor(private readonly photos?: GuestPhotoSource) {}

  /** The guest as the adapter reads it: with the count derived from the photos, not carried. */
  private read(guest: Guest): Guest {
    const photoCount = this.photos?.authoredBy(guest.eventId, guest.id) ?? 0
    return Guest.restore({ ...guest.toProps(), photoCount })
  }

  seed(...guests: readonly Guest[]): this {
    for (const guest of guests) {
      if (guest.photoCount !== 0) {
        throw new Error(
          `seed(${guest.id}): photoCount is derived from the photos, not stored; seed photos into the photo fake handed to this repository instead`,
        )
      }
      this.rows.set(key(guest.eventId, guest.id), guest)
    }
    return this
  }

  async findById(eventId: EventId, guestId: GuestId): Promise<Guest | null> {
    const stored = this.rows.get(key(eventId, guestId))
    return stored === undefined ? null : this.read(stored)
  }

  /**
   * The batched name lookup, scoped by the same composite key as {@link findById}.
   *
   * Going through `Guest.label()` rather than reading `displayName` is deliberate: the
   * domain decides what a guest with no name projects as, and it decides `null` — so a
   * fake that invented "Invité" here would let a wall test pass against a rule the
   * product does not have.
   */
  async findNamesByIds(
    eventId: EventId,
    guestIds: readonly GuestId[],
  ): Promise<ReadonlyMap<GuestId, string>> {
    const names = new Map<GuestId, string>()

    for (const guestId of guestIds) {
      const label = this.rows.get(key(eventId, guestId))?.label() ?? null
      if (label !== null) names.set(guestId, label)
    }

    return names
  }

  async list(eventId: EventId): Promise<readonly Guest[]> {
    return [...this.rows.values()]
      .filter((guest) => guest.eventId === eventId)
      .sort(mostRecentlySeenFirst)
      .map((guest) => this.read(guest))
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

  async touch(eventId: EventId, guestId: GuestId, at: Date): Promise<void> {
    const stored = this.rows.get(key(eventId, guestId))
    // `Guest.touch` never moves backwards, which is the adapter's `last_seen_at < ?`.
    if (stored !== undefined) this.rows.set(key(eventId, guestId), stored.touch(at))
  }

  /** Idempotent: deleting an already-deleted guest is not an error. Their photos go with them. */
  async delete(eventId: EventId, guestId: GuestId): Promise<void> {
    this.rows.delete(key(eventId, guestId))
    this.photos?.deleteAuthoredBy(eventId, guestId)
  }
}
