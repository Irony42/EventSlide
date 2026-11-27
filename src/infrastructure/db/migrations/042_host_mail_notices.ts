import type { Migration } from '../migrator'

/**
 * Mail to the host (spec 32, ADR 0019): the notices the box writes about an event's life, the account's
 * two switches, the digest's per-owner state and the day's mail count.
 *
 * - **`event_mail_notices`**: one row per notice that was served, **noted before the mail is handed to
 *   the relay** (rule 9: a crash in between loses a mail and never sends two). `kind` and `key` say
 *   which notice: `rsvpErasure` `7@<date>`, `rsvpFull` `full@120`, `eventClosed` `first`, `jobDone`
 *   `book@<requested_at>`. **No `CHECK` on `kind`**: the list grows, and SQLite changes a `CHECK` only by
 *   rebuilding the table (the lesson of `audit_log`); the domain judges the vocabulary
 *   (`domain/notices/noticeKind.ts`). The row holds no personal data and goes with its event
 *   (`ON DELETE CASCADE`); the primary key starts with `event_id`, which is the foreign key's index.
 * - **`event_memberships.rsvp_digest` / `rsvp_digest_at`**: whether this owner ticked "send me a daily
 *   summary" for this event, and when the last summary was claimed (written compare-and-set, the winner
 *   sends). The same `ADD COLUMN ... NOT NULL DEFAULT ... CHECK` form as 036.
 * - **`users.mail_rsvp` / `mail_event`**: the account's two family switches, **on** by default.
 * - **`mail_daily_counts`**: how many mails the box sent on a UTC day, against `MAIL_FOLLOWUP_MAX_PER_DAY`.
 *   No address, no event: a day and a number. The balayeur erases the rows after 7 days.
 *
 * Kept in one file so that renumbering it after another migration lands is a two-line change.
 */
export const migration042: Migration = {
  id: 42,
  name: 'host_mail_notices',
  sql: `
      CREATE TABLE IF NOT EXISTS event_mail_notices (
        event_id TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
        kind     TEXT NOT NULL,
        key      TEXT NOT NULL,
        sent_at  TEXT NOT NULL,
        PRIMARY KEY (event_id, kind, key)
      );

      ALTER TABLE event_memberships ADD COLUMN rsvp_digest INTEGER NOT NULL DEFAULT 0
        CHECK (rsvp_digest IN (0, 1));
      ALTER TABLE event_memberships ADD COLUMN rsvp_digest_at TEXT;

      ALTER TABLE users ADD COLUMN mail_rsvp INTEGER NOT NULL DEFAULT 1
        CHECK (mail_rsvp IN (0, 1));
      ALTER TABLE users ADD COLUMN mail_event INTEGER NOT NULL DEFAULT 1
        CHECK (mail_event IN (0, 1));

      CREATE TABLE IF NOT EXISTS mail_daily_counts (
        day   TEXT PRIMARY KEY,
        count INTEGER NOT NULL CHECK (count >= 0)
      );
  `,
}
