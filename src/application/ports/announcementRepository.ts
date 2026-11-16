import type { Announcement } from '../../domain/announcements/announcement'
import type { AnnouncementId, EventId } from '../../domain/shared/ids'

/** How an attempt to schedule an announcement ended: each refusal is a different `409`. */
export type CreateAnnouncementOutcome = 'created' | 'overlap' | 'limitReached'

/** How an attempt to change one ended. */
export type SaveAnnouncementOutcome = 'saved' | 'overlap' | 'notFound'

/**
 * The scheduled announcements of an event (spec 21).
 *
 * Every method takes `eventId` first: an announcement is read by the public wall, and a lookup
 * that could answer with another event's row would put a stranger's sentence on a projector.
 * An identifier of another evening is a miss, never a hit.
 */
export interface AnnouncementRepository {
  /** All of the event's announcements, by moment, then by id (the host's list; fifty at most). */
  listByEvent(eventId: EventId): Promise<readonly Announcement[]>

  findById(eventId: EventId, id: AnnouncementId): Promise<Announcement | null>

  /**
   * The wall's read: announcements that start at `from` or later, by moment, at most `limit`.
   * Bounded by the caller, never by what a request typed.
   */
  listAround(eventId: EventId, from: Date, limit: number): Promise<readonly Announcement[]>

  /**
   * Adds `announcement` unless the event already holds `ceiling` of them or one **of the same
   * kind** overlaps it, and does the two checks and the insert as **one step**: two moderators
   * scheduling together must not both win. Neither rule can be an index (they depend on the
   * durations), so this method is where they are true.
   */
  tryCreate(announcement: Announcement, ceiling: number): Promise<CreateAnnouncementOutcome>

  /**
   * Replaces an existing announcement (its text, kind, moment, durations) unless one of the same
   * kind, **other than itself**, overlaps the result; the check and the write are one step.
   */
  trySave(announcement: Announcement): Promise<SaveAnnouncementOutcome>

  /** Removes one. Whether a row of this event was removed. */
  delete(eventId: EventId, id: AnnouncementId): Promise<boolean>
}
