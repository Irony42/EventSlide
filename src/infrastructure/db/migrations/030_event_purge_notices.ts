import type { Migration } from '../migrator'

/**
 * Which warning an event's owners were last written to about its deletion (spec 22): "your album
 * will be deleted on …", sent 14, 3 and 1 day before.
 *
 * One row per event, replaced as the threshold gets closer, so a level already noted is never sent
 * again. The row is written **before** the message goes out: a crash in between loses a message and
 * never sends it twice. The row holds a threshold and an instant and no personal data, and goes with
 * its event (`ON DELETE CASCADE`), which is how the retention purge, an offboarding and an operator's
 * removal all reach it. The primary key starts with `event_id`, which is the foreign key's index.
 */
export const migration030: Migration = {
  id: 30,
  name: 'event_purge_notices',
  sql: `
      CREATE TABLE IF NOT EXISTS event_purge_notices (
        event_id  TEXT PRIMARY KEY REFERENCES events (id) ON DELETE CASCADE,
        level     INTEGER NOT NULL CHECK (level IN (14, 3, 1)),
        sent_at   TEXT NOT NULL
      );
  `,
}
