import type { GuestInvite } from '../../domain/guestInvites/guestInvite'
import type { GuestInviteToken } from '../../domain/guestInvites/guestInviteToken'
import type { RsvpSettings } from '../../domain/guestRsvps/rsvpSettings'
import type { EventId } from '../../domain/shared/ids'

/**
 * The guest invitation of an event (spec 29): at most one per event.
 *
 * `findByEvent` takes the event first, like every event-scoped port. `findByToken` is the public
 * page's read and is the one lookup that starts from a secret: it answers the invitation and
 * **nothing else**. It never joins the event, so the suspension and take-down facts (which only
 * `EventRepository.findById` fills) are read by the caller, in a second step.
 *
 * **Each write changes one thing**, so a use case that read the row a moment ago cannot put back
 * what it read over what somebody else wrote since: a save of the text never touches the switch
 * or the token, and a switch or a new token never touches the text.
 */
export interface GuestInviteRepository {
  findByEvent(eventId: EventId): Promise<GuestInvite | null>

  /** The invitation a link names, whether or not it is switched on (the caller decides). */
  findByToken(token: GuestInviteToken): Promise<GuestInvite | null>

  /**
   * Inserts the event's first invitation, with its token and switch. An event that already has
   * one, or a token another event holds, is a bug (a race, or 80 random bits colliding), not a
   * case: the adapter rejects.
   */
  create(invite: GuestInvite): Promise<void>

  /**
   * Writes the **content and `updatedAt`** of the event's invitation and nothing else: the token
   * and the switch of `invite` are ignored, whatever it read. No row is a no-op.
   */
  saveContent(invite: GuestInvite): Promise<void>

  /** Switches the link on or off. The text and the token are not touched. No row is a no-op. */
  setEnabled(eventId: EventId, enabled: boolean, at: Date): Promise<void>

  /**
   * Replaces the token: the old one stops answering at once. A token another event holds is
   * rejected, as in {@link GuestInviteRepository.create}. No row is a no-op.
   */
  rotateToken(eventId: EventId, token: GuestInviteToken, at: Date): Promise<void>

  /**
   * What the host decided about replies (spec 30): the switch, the deadline, the manual closing and
   * the form, read with the invitation's row. `null` when the event has no invitation; a row that
   * never saved any setting answers the defaults (switched off, no deadline, not closed).
   */
  findRsvpSettings(eventId: EventId): Promise<RsvpSettings | null>

  /**
   * Writes the switch, the deadline and the form, and **not** the closing, which a save of the form
   * must not put back or lift (`setRsvpClosedAt` is the one door for it). The invitation's text,
   * token, switch and `updatedAt` are not touched. No row is a no-op.
   */
  saveRsvpSettings(eventId: EventId, settings: RsvpSettings): Promise<void>

  /**
   * The events whose replies are asked and **not closed by hand**, with a deadline day between `fromDay` and `toDay`
   * (both included, `YYYY-MM-DD`): the candidates of the deadline reminder (R3) and of the summary after the stop (R4),
   * which judge the exact instant themselves (a day is read in the invitation's zone). One bounded read.
   */
  eventsWithRsvpDeadlineBetween(fromDay: string, toDay: string): Promise<readonly EventId[]>

  /**
   * The events whose replies are asked and not closed by hand, and whose form limits the places: the candidates of the
   * "full" notice (R5), which compares the people who come with the capacity, **and whose party has not started** (`startingAfter`: an
   * invitation with no start is left out, a party gone by has nothing to fill). One bounded read.
   */
  eventsWithRsvpCapacity(startingAfter: Date): Promise<readonly EventId[]>

  /** Closes the replies at `closedAt`, or reopens them with `null`. Nothing else is touched. No row is a no-op. */
  setRsvpClosedAt(eventId: EventId, closedAt: Date | null): Promise<void>
}
