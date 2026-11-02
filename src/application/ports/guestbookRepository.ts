import type { EntryStatus, GuestbookEntry } from '../../domain/guestbook/guestbookEntry'
import type { GuestbookRefusal } from '../../domain/guestbook/guestbookLimits'
import type { EventId, GuestId, GuestbookEntryId } from '../../domain/shared/ids'

/**
 * The guestbook's messages (spec 01).
 *
 * Every method takes `eventId` first and no query can answer with another event's row: an entry
 * id arrives in a URL (`DELETE /guestbook/:entryId`), so a lookup by id alone would be a route by
 * which a guest at one wedding removes a message at another. There is deliberately no
 * `findById(entryId)`.
 *
 * **Every read leaves out a message the operator took down** (`taken_down_at`), as the photo
 * repository does, so no surface that reads through this port can serve one. The two counts a
 * ceiling is judged on are the exception, and say so.
 */

/** What {@link GuestbookRepository.admit} decided, in one transaction. */
export type GuestbookAdmission =
  /** Stored. */
  | { readonly kind: 'added'; readonly entry: GuestbookEntry }
  /** The same guest sent the same text a moment ago: that row, and nothing new. */
  | { readonly kind: 'duplicate'; readonly entry: GuestbookEntry }
  /** A ceiling is reached; nothing was stored. */
  | { readonly kind: 'refused'; readonly refusal: GuestbookRefusal }

export interface GuestbookRepository {
  /** Scoped lookup. A taken-down message is not found. */
  findById(eventId: EventId, entryId: GuestbookEntryId): Promise<GuestbookEntry | null>

  /**
   * Store a message, or say why not, deciding **inside one write transaction**.
   *
   * In this order: a message identical to one the same guest wrote within the last minute is the
   * same message (a double tap, a retry on bad Wi-Fi), answered with that row and no new row; then
   * the ceilings (`guestbookRefusalFor`, the same function the fake runs), counted with
   * {@link countByGuest} and {@link countOpenByEvent}. The duplicate check comes first so a guest
   * at their limit who double-taps is told "sent", not "too many". The transaction is what makes
   * the ceilings hold when requests overlap.
   */
  admit(entry: GuestbookEntry): Promise<GuestbookAdmission>

  /**
   * Record a moderation decision on a message that exists: its status and its review. Nothing else
   * about a stored message ever changes (there is no editing), and a message that is not there, or
   * is taken down, is left alone and not created.
   */
  save(entry: GuestbookEntry): Promise<void>

  /**
   * An event's messages in the given statuses, **oldest first**, at most `limit`. For the album
   * export (`isInAlbum` statuses) and, later, the host's queue and the wall. A taken-down
   * message is never in it.
   */
  listByStatuses(
    eventId: EventId,
    statuses: readonly EntryStatus[],
    limit: number,
  ): Promise<readonly GuestbookEntry[]>

  /** The guest's own messages, newest first, at most `limit`. */
  listByGuest(eventId: EventId, guestId: GuestId, limit: number): Promise<readonly GuestbookEntry[]>

  /**
   * Every message this guest wrote that still exists, **taken-down ones included**: the per-guest
   * ceiling must not be beaten by getting a message refused or removed.
   */
  countByGuest(eventId: EventId, guestId: GuestId): Promise<number>

  /**
   * The messages the host can still act on (`pending`, `published`, `hidden`), refused and
   * taken-down ones left out, so nobody can fill the book with text that is then turned down.
   */
  countOpenByEvent(eventId: EventId): Promise<number>

  /** Idempotent. */
  delete(eventId: EventId, entryId: GuestbookEntryId): Promise<void>

  /**
   * Every message of this guest, for their erasure. **Skips what the operator took down**, which
   * is preserved evidence, and does not count it. Returns how many were removed.
   */
  deleteByGuest(eventId: EventId, guestId: GuestId): Promise<number>

  /** How many of this guest's messages the operator took down, which every read leaves out. */
  countTakenDownBy(eventId: EventId, guestId: GuestId): Promise<number>

  /**
   * Which event holds this message, **across every event**: the one read in this port that is not
   * scoped by `eventId`, and the documented exception for the operator's take-down, who is told
   * "message <id>" and has no event to name (the same exception `PhotoRepository.locate` is). It
   * answers an id and an instant and never the text, and it sees a taken-down row, which every
   * other read leaves out. `null` for an id no row holds.
   */
  locate(entryId: GuestbookEntryId): Promise<GuestbookLocation | null>

  /**
   * Takes a message down (`at`) or puts it back (`null`), for the operator. Scoped by event and
   * idempotent. `save` never writes this column, so the host's moderation cannot undo it, and a
   * taken-down row stays counted for its guest's ceiling and is skipped by the guest's erasure.
   */
  setTakenDown(eventId: EventId, entryId: GuestbookEntryId, at: Date | null): Promise<void>
}

/** Where a message lives, and nothing else: ids and an instant, never the text or the author. */
export interface GuestbookLocation {
  readonly eventId: EventId
  /** When the operator took it down, or `null` while it is up. */
  readonly takenDownAt: Date | null
}
