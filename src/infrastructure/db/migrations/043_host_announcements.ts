import type { Migration } from '../migrator'

/**
 * Announcements to the hosts (spec 32, lot 2, A8): what the operator writes to every host (a change of terms, of a
 * sub-processor, the end of the service) and who it already reached, so that a sending that a restart interrupted resumes
 * where it stopped and **never writes to the same account twice**.
 *
 * - **`host_announcements`**: the operator's subject, text and optional link, who wrote it (`ON DELETE SET NULL`: the text
 *   outlives the account) and when it was done (`finished_at`, `NULL` while it is going out). The text is **kept 365 days**
 *   as proof that hosts were told (the terms promise it), then erased by the retention sweep.
 * - **`host_announcement_deliveries`**: one row per account reached, written **before** the mail is handed to the relay (a
 *   crash in between loses a mail and never sends two: rule 9). `ON DELETE CASCADE` on both keys. **Erased 30 days after
 *   `finished_at`** by the retention sweep: it holds an account id, and nothing needs it once the sending is over. The
 *   primary key starts with `announcement_id` (that foreign key's index); `user_id` has its own.
 *
 * No address is stored: the recipients are read, at each batch, from the accounts that own a client.
 */
export const migration043: Migration = {
  id: 43,
  name: 'host_announcements',
  sql: `
      CREATE TABLE IF NOT EXISTS host_announcements (
        id          TEXT PRIMARY KEY,
        subject     TEXT NOT NULL,
        text        TEXT NOT NULL,
        link        TEXT,
        created_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
        created_at  TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_host_announcements_created_by
        ON host_announcements (created_by);
      CREATE INDEX IF NOT EXISTS idx_host_announcements_finished_at
        ON host_announcements (finished_at);
      CREATE INDEX IF NOT EXISTS idx_host_announcements_created_at
        ON host_announcements (created_at);

      CREATE TABLE IF NOT EXISTS host_announcement_deliveries (
        announcement_id TEXT NOT NULL REFERENCES host_announcements (id) ON DELETE CASCADE,
        user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        sent_at         TEXT NOT NULL,
        PRIMARY KEY (announcement_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_host_announcement_deliveries_user_id
        ON host_announcement_deliveries (user_id);
  `,
}
