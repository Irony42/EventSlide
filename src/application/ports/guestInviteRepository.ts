import type { GuestInvite } from '../../domain/guestInvites/guestInvite'
import type { GuestInviteToken } from '../../domain/guestInvites/guestInviteToken'
import type { EventId } from '../../domain/shared/ids'

/**
 * The guest invitation of an event (spec 29): at most one per event.
 *
 * `findByEvent` takes the event first, like every event-scoped port. `findByToken` is the public
 * page's read and is the one lookup that starts from a secret: it answers the invitation and
 * **nothing else**. It never joins the event, so the suspension and take-down facts (which only
 * `EventRepository.findById` fills) are read by the caller, in a second step.
 */
export interface GuestInviteRepository {
  findByEvent(eventId: EventId): Promise<GuestInvite | null>

  /** The invitation a link names, whether or not it is switched on (the caller decides). */
  findByToken(token: GuestInviteToken): Promise<GuestInvite | null>

  /**
   * Inserts the event's invitation or replaces it (content, switch, token). A token another
   * event holds is a bug, not a case: 80 random bits do not collide, so the adapter rejects.
   */
  save(invite: GuestInvite): Promise<void>
}
