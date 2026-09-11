import type { Guest } from '../../domain/guests/guest'
import type { EventId, GuestId } from '../../domain/shared/ids'

/**
 * Guests are event-scoped by construction: a guest row belongs to exactly one event,
 * so a device token issued for one wedding is meaningless at another. Every lookup
 * therefore takes `eventId`, and `findById` without it does not exist.
 */
export interface GuestRepository {
  findById(eventId: EventId, guestId: GuestId): Promise<Guest | null>

  /**
   * The display names of several guests at once, keyed by guest id.
   *
   * The wall credits every slide it plays, and a playlist is many photos by few guests.
   * Without a batched read the projector would issue one `findById` per slide on the one
   * surface that has to stay smooth for eight hours — the N+1 that 1.0 shipped.
   *
   * A guest is **absent** from the result whenever there is no name to show: they stayed
   * anonymous, the id is unknown, or the row belongs to another event. A caller therefore
   * reads a miss and a deliberate silence identically, which is exactly what a public
   * projector should do — show no credit, never an invented one.
   *
   * Only the name crosses. Presence, revocation and photo counts are a host's view of a
   * guest; this read serves a screen in a room of strangers.
   */
  findNamesByIds(
    eventId: EventId,
    guestIds: readonly GuestId[],
  ): Promise<ReadonlyMap<GuestId, string>>

  list(eventId: EventId): Promise<readonly Guest[]>

  /** Guests seen within the window — the host's "who is here right now" count. */
  countActive(eventId: EventId, since: Date): Promise<number>

  save(guest: Guest): Promise<void>

  delete(eventId: EventId, guestId: GuestId): Promise<void>
}
