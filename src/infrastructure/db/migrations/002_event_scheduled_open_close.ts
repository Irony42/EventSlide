import type { Migration } from '../migrator'

/**
 * Scheduled opening and closing (docs/ROADMAP.md §3.4).
 *
 * Two nullable columns rather than a reuse of `starts_at`. `starts_at` is the printed
 * start of the party, written once when the event is created and read by no rule; every
 * row that already holds one was given it by a host who was told it did nothing. Making
 * it a trigger would open events retroactively, with no way to decline — so the trigger
 * is its own pair of columns, empty for every existing row, and arming it is a choice.
 *
 * Both are ISO-8601 UTC `TEXT`, like every other timestamp in this schema: they sort and
 * compare lexicographically, which is what lets the sweep's `<=` run in SQLite.
 *
 * The third column, `schedule_discarded_at`, is what stops the sweep deleting something
 * the host configured without telling them. A due instant the lifecycle refuses is spent
 * rather than retried forever, and this is the only record that it ever existed — the
 * settings page would otherwise read back "no schedule" with no explanation.
 *
 * `ALTER TABLE … ADD COLUMN` has no `IF NOT EXISTS` in SQLite. It does not need one: the
 * ledger applies a migration exactly once, and against a fresh database `001` has just
 * created a table without these columns.
 */
export const migration002: Migration = {
  id: 2,
  name: 'event_scheduled_open_close',
  sql: `
      ALTER TABLE events ADD COLUMN scheduled_open_at    TEXT;
      ALTER TABLE events ADD COLUMN scheduled_close_at   TEXT;
      -- Read only with the aggregate, never queried on, so it carries no index.
      ALTER TABLE events ADD COLUMN schedule_discarded_at TEXT;

      -- Partial, and not led by event_id: this is the one query in the product that is
      -- not scoped to an event — the sweep asks "which events, anywhere, are due". The
      -- WHERE clause keeps the index the size of the handful of events that are actually
      -- scheduled rather than the size of the archive.
      CREATE INDEX IF NOT EXISTS idx_events_scheduled_open
        ON events (scheduled_open_at)
        WHERE scheduled_open_at IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_events_scheduled_close
        ON events (scheduled_close_at)
        WHERE scheduled_close_at IS NOT NULL;
    `,
}
