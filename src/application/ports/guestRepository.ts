import type { Guest } from '../../domain/guests/guest'
import type { EventId, GuestId } from '../../domain/shared/ids'

/**
 * Guests are event-scoped by construction: a guest row belongs to exactly one event,
 * so a device token issued for one wedding is meaningless at another. Every lookup
 * therefore takes `eventId`, and `findById` without it does not exist.
 */
export interface GuestRepository {
  findById(eventId: EventId, guestId: GuestId): Promise<Guest | null>

  list(eventId: EventId): Promise<readonly Guest[]>

  /** Guests seen within the window — the host's "who is here right now" count. */
  countActive(eventId: EventId, since: Date): Promise<number>

  save(guest: Guest): Promise<void>

  delete(eventId: EventId, guestId: GuestId): Promise<void>
}
