import type { HostAnnouncement } from '../../domain/hostAnnouncements/hostAnnouncement'
import type {
  HostAnnouncementProgress,
  HostAnnouncementRepository,
  PendingRecipient,
} from '../../application/ports/hostAnnouncementRepository'
import type { Db } from './connection'
import { fromIsoText, fromNullableIsoText, toIsoText } from './rowMapping'

interface Row {
  readonly id: string
  readonly subject: string
  readonly text: string
  readonly link: string | null
  readonly created_by: string | null
  readonly created_at: string
  readonly finished_at: string | null
}

const toAnnouncement = (row: Row): HostAnnouncement => ({
  id: row.id,
  subject: row.subject,
  text: row.text,
  link: row.link,
  createdBy: row.created_by,
  createdAt: fromIsoText(row.created_at),
  finishedAt: fromNullableIsoText(row.finished_at),
})

/**
 * `host_announcements` and `host_announcement_deliveries` (migration 043).
 *
 * The recipients are **read, never stored**: the accounts that are not switched off (`disabled_at IS NULL`) and own at least
 * one client (`client_members.role = 'owner'`), by id, minus those with a delivery row. A delivery is one `INSERT OR IGNORE`
 * whose `changes` says who won (noted before sent).
 */
export class SqliteHostAnnouncementRepository implements HostAnnouncementRepository {
  constructor(private readonly db: Db) {}

  async create(announcement: HostAnnouncement): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO host_announcements (id, subject, text, link, created_by, created_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        announcement.id,
        announcement.subject,
        announcement.text,
        announcement.link,
        announcement.createdBy,
        toIsoText(announcement.createdAt),
        announcement.finishedAt === null ? null : toIsoText(announcement.finishedAt),
      )
  }

  async listRecent(limit: number): Promise<readonly HostAnnouncementProgress[]> {
    return this.db
      .prepare<[number], Row & { readonly delivered: number }>(
        `SELECT a.id, a.subject, a.text, a.link, a.created_by, a.created_at, a.finished_at,
                (SELECT COUNT(*) FROM host_announcement_deliveries d WHERE d.announcement_id = a.id) AS delivered
           FROM host_announcements a
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT ?`,
      )
      .all(limit)
      .map((row) => ({ announcement: toAnnouncement(row), delivered: row.delivered }))
  }

  async unfinished(): Promise<readonly HostAnnouncement[]> {
    return this.db
      .prepare<[], Row>(
        `SELECT id, subject, text, link, created_by, created_at, finished_at
           FROM host_announcements
          WHERE finished_at IS NULL
          ORDER BY created_at ASC, id ASC`,
      )
      .all()
      .map(toAnnouncement)
  }

  async countRecipients(): Promise<number> {
    return (
      this.db
        .prepare<[], { readonly n: number }>(
          `SELECT COUNT(*) AS n FROM users u
            WHERE u.disabled_at IS NULL
              AND EXISTS (SELECT 1 FROM client_members m WHERE m.user_id = u.id AND m.role = 'owner')`,
        )
        .get()?.n ?? 0
    )
  }

  async pendingRecipients(
    announcementId: string,
    limit: number,
  ): Promise<readonly PendingRecipient[]> {
    return this.db
      .prepare<[string, number], { readonly id: string; readonly email: string }>(
        `SELECT u.id, u.email FROM users u
          WHERE u.disabled_at IS NULL
            AND EXISTS (SELECT 1 FROM client_members m WHERE m.user_id = u.id AND m.role = 'owner')
            AND NOT EXISTS (SELECT 1 FROM host_announcement_deliveries d
                             WHERE d.announcement_id = ? AND d.user_id = u.id)
          ORDER BY u.id
          LIMIT ?`,
      )
      .all(announcementId, limit)
      .map((row) => ({ userId: row.id, email: row.email }))
  }

  async recordDelivery(announcementId: string, userId: string, at: Date): Promise<boolean> {
    return (
      this.db
        .prepare(
          `INSERT OR IGNORE INTO host_announcement_deliveries (announcement_id, user_id, sent_at)
           SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM host_announcements WHERE id = ?)`,
        )
        .run(announcementId, userId, toIsoText(at), announcementId).changes === 1
    )
  }

  async finish(announcementId: string, at: Date): Promise<void> {
    this.db
      .prepare(`UPDATE host_announcements SET finished_at = ? WHERE id = ? AND finished_at IS NULL`)
      .run(toIsoText(at), announcementId)
  }

  async deleteDeliveriesFinishedBefore(cutoff: Date): Promise<number> {
    return this.db
      .prepare(
        `DELETE FROM host_announcement_deliveries
          WHERE announcement_id IN (
            SELECT id FROM host_announcements WHERE finished_at IS NOT NULL AND finished_at < ?)`,
      )
      .run(toIsoText(cutoff)).changes
  }

  async deleteCreatedBefore(cutoff: Date): Promise<number> {
    return this.db
      .prepare(`DELETE FROM host_announcements WHERE created_at < ?`)
      .run(toIsoText(cutoff)).changes
  }
}
