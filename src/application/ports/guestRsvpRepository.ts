import type { GuestRsvp } from '../../domain/guestRsvps/rsvp'
import type { RsvpRefusal } from '../../domain/guestRsvps/rsvpLimits'
import type { EventId, GuestRsvpId, UserId } from '../../domain/shared/ids'

/**
 * The replies guests give to an invitation (spec 30).
 *
 * Every method takes `eventId` first and no query answers with another event's reply: a reply id
 * arrives in a host's URL and a token digest arrives from the public, so a lookup by either alone
 * would be a way across events (CLAUDE.md section 3, rule 5). There is deliberately no
 * `findById(id)` and no `findByEditTokenHash(hash)`.
 *
 * `edit_token_hash` is the SHA-256 of the guest's token. The token itself is never stored.
 */

/** What {@link GuestRsvpRepository.admit} decided, in one transaction. */
export type GuestRsvpAdmission =
  /** A new reply, stored. */
  | { readonly kind: 'added'; readonly rsvp: GuestRsvp }
  /** A change to a reply that existed: this is the row as it now stands. */
  | { readonly kind: 'updated'; readonly rsvp: GuestRsvp }
  /** A ceiling is reached; nothing was written. */
  | { readonly kind: 'refused'; readonly refusal: RsvpRefusal }
  /** `changeOnly` was asked and the reply is not there (deleted meanwhile): nothing was written. */
  | { readonly kind: 'gone' }

/** What `admit` judges against, besides the thousand-reply ceiling it always applies. */
export interface GuestRsvpAdmitLimits {
  /** Places in people, or `null` for none (lot 4). */
  readonly capacity: number | null
  /**
   * The call is a **change** to a reply the caller read: if it is no longer there (a delete came
   * in between), nothing is added, the answer is `gone`. Without it a change whose reply vanished
   * would store it again, a guest's own deletion undone by their other tab.
   */
  readonly changeOnly?: boolean
}

export interface GuestRsvpRepository {
  /** An event's replies, the most recently changed first (ties: the greater id first). */
  listByEvent(eventId: EventId): Promise<readonly GuestRsvp[]>

  findById(eventId: EventId, id: GuestRsvpId): Promise<GuestRsvp | null>

  /** The reply of the event whose token digest this is. A digest valid elsewhere finds nothing. */
  findByEditTokenHash(eventId: EventId, hash: string): Promise<GuestRsvp | null>

  /** The reply of a household (at most one). */
  findByHousehold(eventId: EventId, householdId: string): Promise<GuestRsvp | null>

  /**
   * Stores a reply, or changes one, or says why not, deciding **inside one write transaction**
   * (`rsvpRefusalFor`, the same function the fake runs):
   *
   * - a reply whose id the event already holds, or whose household already has one, is a **change**:
   *   the content (name, answer, counts, details, diet, message) and `updatedAt` are replaced, and
   *   the id, token digest, source, household and creation instant stay as stored;
   * - otherwise it is added, unless the event already holds 1 000 replies (`tooMany`);
   * - a `yes` is refused (`full`) when the people of the other `yes` replies plus its own pass
   *   `limits.capacity`: the old value of the reply being changed does not count against it.
   */
  admit(rsvp: GuestRsvp, limits: GuestRsvpAdmitLimits): Promise<GuestRsvpAdmission>

  /**
   * Replaces everything about a reply that a host may change: the content, the household and
   * `updatedAt`. Not subject to any ceiling (the host decides). Says whether such a reply existed
   * and was changed: `false` for one that is gone or another event's, nothing written.
   */
  update(rsvp: GuestRsvp): Promise<boolean>

  /**
   * How many replies were written or changed after this member's last visit to the replies page
   * (`event_memberships.rsvp_seen_at`): the badge. A member who never visited, or who has no
   * membership of the event, has seen none.
   */
  unseenCount(eventId: EventId, userId: UserId): Promise<number>

  /** Notes that this member has seen the replies up to `at`. No membership is a no-op. */
  markSeen(eventId: EventId, userId: UserId, at: Date): Promise<void>

  /** Whether a reply was deleted. */
  delete(eventId: EventId, id: GuestRsvpId): Promise<boolean>

  /**
   * Deletes the replies whose event has expired (`isRsvpExpired`: 30 days after it closed, or 60
   * after the invitation's start, the earlier winning) and says how many. The purge hold does not
   * keep them.
   */
  deleteExpired(now: Date): Promise<number>
}
