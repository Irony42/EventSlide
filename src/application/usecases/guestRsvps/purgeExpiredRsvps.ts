import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { GuestHouseholdRepository } from '../../ports/guestHouseholdRepository'
import type { GuestRsvpRepository } from '../../ports/guestRsvpRepository'
import type { InvalidateBook } from '../book/invalidateAlbumBook'
import type { InvalidateExport } from '../exports/invalidateAlbumExport'
import { afterNotesErased, beforeNotesErased } from './absentNoteErasure'

/**
 * Erases the replies whose time has come (spec 30, section 7), from the retention sweeper: 30 days
 * after the event closed or 60 after the invitation's start, whichever is first (`rsvpExpiryOf`).
 * It reads no event and asks no hold: **the purge hold does not keep replies**, they are names and
 * diets, not an album. The guest list's households go with them, on the same dates. Run before the public form opens, because collecting without erasing is the
 * one order that is wrong.
 *
 * A reply's note to the guestbook (lot 4) goes with it, so for each event holding one the photo book and
 * the archive are retired first and the guestbook's signal follows (`absentNoteErasure`).
 */

export interface PurgeExpiredRsvpsDeps {
  readonly rsvps: Pick<GuestRsvpRepository, 'deleteExpired' | 'eventsWithExpiredNotes'>
  readonly households: Pick<GuestHouseholdRepository, 'deleteExpired'>
  readonly clock: Clock
  readonly bus: Pick<EventBus, 'publish'>
  readonly invalidateBook?: InvalidateBook
  readonly invalidateExport?: InvalidateExport
}

export interface PurgeExpiredRsvpsReport {
  /** Rows erased: replies and households together. */
  readonly deleted: number
}

export type PurgeExpiredRsvps = () => Promise<PurgeExpiredRsvpsReport>

export const makePurgeExpiredRsvps =
  (deps: PurgeExpiredRsvpsDeps): PurgeExpiredRsvps =>
  async () => {
    const { rsvps, households, clock } = deps
    const now = clock.now()
    // Read before the erasure, which takes the notes with the replies.
    const withNotes = await rsvps.eventsWithExpiredNotes(now)
    for (const eventId of withNotes) await beforeNotesErased(deps, eventId)
    const deleted = (await rsvps.deleteExpired(now)) + (await households.deleteExpired(now))
    for (const eventId of withNotes) await afterNotesErased(deps, eventId)
    return { deleted }
  }
