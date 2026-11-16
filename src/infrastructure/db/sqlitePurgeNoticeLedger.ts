import type { PurgeNoticeLedger } from '../../application/ports/purgeNoticeLedger'
import { isPurgeNoticeLevel, type PurgeNoticeLevel } from '../../domain/clients/purgeNotice'
import type { EventId } from '../../domain/shared/ids'
import type { Db } from './connection'
import { toIsoText } from './rowMapping'

/**
 * `event_purge_notices` (migration 030).
 *
 * `note` is one statement: `INSERT … SELECT` from `events`, so an event that does not exist
 * inserts no row (rather than failing on the foreign key), and `ON CONFLICT DO UPDATE` replaces
 * the level the way the port says.
 */
export class SqlitePurgeNoticeLedger implements PurgeNoticeLedger {
  constructor(private readonly db: Db) {}

  async lastLevel(eventId: EventId): Promise<PurgeNoticeLevel | null> {
    const row = this.db
      .prepare<[string], { level: number }>(
        `SELECT level FROM event_purge_notices WHERE event_id = ?`,
      )
      .get(eventId)
    // The `CHECK` holds the same vocabulary; the guard is what a row written by a newer build (a
    // threshold this one does not know) turns into: nothing noted.
    return row !== undefined && isPurgeNoticeLevel(row.level) ? row.level : null
  }

  async note(eventId: EventId, level: PurgeNoticeLevel, at: Date): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO event_purge_notices (event_id, level, sent_at)
              SELECT id, ?, ? FROM events WHERE id = ?
         ON CONFLICT (event_id) DO UPDATE SET level = excluded.level, sent_at = excluded.sent_at`,
      )
      .run(level, toIsoText(at), eventId)
  }
}
