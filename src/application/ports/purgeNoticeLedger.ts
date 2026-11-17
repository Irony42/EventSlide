import type { PurgeNoticeLevel } from '../../domain/clients/purgeNotice'
import type { EventId } from '../../domain/shared/ids'

/**
 * Which warning an event's owners were last written to about its deletion (spec 22): one row
 * per event, holding the threshold (14, 3 or 1 days before) and when it was **noted**.
 *
 * It is noted **before** the message is handed to the relay, so a crash between the two costs a
 * lost message and never a second one. Nothing here is an authority and no guest's data is in
 * it: it changes what the owners are told, never what a request may do.
 */
export interface PurgeNoticeLedger {
  /** The threshold last noted for this event, or `null` when none was (or the event is unknown). */
  lastLevel(eventId: EventId): Promise<PurgeNoticeLevel | null>

  /**
   * Notes that `level` was sent, replacing what was noted before. Noting for an event that does
   * not exist records nothing. The row goes with its event (`ON DELETE CASCADE`).
   */
  note(eventId: EventId, level: PurgeNoticeLevel, at: Date): Promise<void>
}
