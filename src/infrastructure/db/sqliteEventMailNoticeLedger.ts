import type { EventMailNoticeLedger } from '../../application/ports/eventMailNoticeLedger'
import { isNoticeKind, type NoticeKind } from '../../domain/notices/noticeKind'
import type { EventId } from '../../domain/shared/ids'
import type { Db } from './connection'
import { toIsoText } from './rowMapping'

/**
 * `event_mail_notices` (migration 042).
 *
 * `note` is one statement and its `changes` is the answer: `INSERT … SELECT` from `events` (so an event
 * that does not exist inserts no row, rather than failing on the foreign key) with `ON CONFLICT DO NOTHING`,
 * which makes the write that placed the row the only one that sees `1`. That is what lets the retention
 * timer and `npm run purge` run together and send one mail.
 *
 * The table has no `CHECK` on `kind` (the list grows, and a SQLite `CHECK` is changed by rebuilding the
 * table), so the domain's vocabulary is applied here, before the statement.
 */
export class SqliteEventMailNoticeLedger implements EventMailNoticeLedger {
  constructor(private readonly db: Db) {}

  async note(eventId: EventId, kind: NoticeKind, key: string, at: Date): Promise<boolean> {
    if (!isNoticeKind(kind)) throw new Error(`unknown notice kind: ${String(kind)}`)
    const result = this.db
      .prepare(
        `INSERT INTO event_mail_notices (event_id, kind, key, sent_at)
              SELECT id, ?, ?, ? FROM events WHERE id = ?
         ON CONFLICT (event_id, kind, key) DO NOTHING`,
      )
      .run(kind, key, toIsoText(at), eventId)
    return result.changes === 1
  }

  async has(eventId: EventId, kind: NoticeKind, key: string): Promise<boolean> {
    const row = this.db
      .prepare(
        `SELECT 1 AS found FROM event_mail_notices WHERE event_id = ? AND kind = ? AND key = ?`,
      )
      .get(eventId, kind, key)
    return row !== undefined
  }
}
