import type { Migration } from '../migrator'

/**
 * The after-party counters of the host statistics page (spec 05, PR B): how many times the
 * shared album's link was opened and how many times its ZIP was launched, as **one integer per
 * event, metric and UTC day**.
 *
 * Nothing else is stored, on purpose: no address, no user agent, no link id, no guest id. A row
 * says "that day, this event, 12 opens", which cannot be turned back into who opened what. The
 * rows go with the event (`ON DELETE CASCADE`), at a purge as at the retention deadline.
 *
 * **No `CHECK (metric IN (...))`.** Migrations are append-only and SQLite cannot change a
 * `CHECK` without rebuilding the table, so the closed vocabulary lives in
 * `src/domain/stats/statsMetric.ts` and a metric added later needs no migration. The length
 * bounds below only keep a bug from writing a paragraph in a key.
 */
export const migration018: Migration = {
  id: 18,
  name: 'event_stats_counters',
  sql: `
      CREATE TABLE IF NOT EXISTS event_stats_counters (
        event_id TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
        metric   TEXT NOT NULL CHECK (length(metric) BETWEEN 1 AND 40),
        day      TEXT NOT NULL CHECK (length(day) = 10),
        value    INTEGER NOT NULL CHECK (value >= 0),
        PRIMARY KEY (event_id, metric, day)
      );
    `,
}
