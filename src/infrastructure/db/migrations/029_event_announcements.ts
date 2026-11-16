import type { Migration } from '../migrator'

/**
 * Scheduled announcements on the wall (spec 21): "Gâteau à 22 h", a card in the middle of the
 * screen after an optional countdown (`fullscreen`), or a short text laid over the photographs
 * for up to half an hour (`discreet`).
 *
 * **A table, and not a key of `events.settings`**, for the reason migration 024 gives for the
 * challenge: `PATCH /settings` reads and rewrites the whole blob, so two moderators scheduling
 * at once would lose one another's announcement, and the blob's hydration is strict.
 *
 * **There is no state column and no timer.** Whether an announcement is coming, counting down,
 * on screen or over is derived from `at`, the two durations and the clock; nothing fires when it
 * starts or ends. `at` is an ISO 8601 UTC instant to the millisecond, like `started_at`, so
 * comparing the text is comparing the time.
 *
 * - The countdown only exists for a fullscreen card: the second `CHECK` says so, and the domain
 *   says it first. The bounds of the duration are the domain's (they differ by kind and are a
 *   fact of the product, not of the schema), so they are not repeated here.
 * - **Two announcements of one kind never overlap, and an event holds at most fifty.** Neither
 *   can be an index (they depend on the durations), so the adapter holds both in one synchronous
 *   transaction.
 * - `created_by` is a host account id, never a guest's, and has no foreign key: the row keeps no
 *   personal data and need not follow a user's deletion. The rows go with their event
 *   (`ON DELETE CASCADE`), which is also how an operator's removal and a purge reach them.
 */
export const migration029: Migration = {
  id: 29,
  name: 'event_announcements',
  sql: `
      CREATE TABLE IF NOT EXISTS event_announcements (
        id                 TEXT PRIMARY KEY,
        event_id           TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
        text               TEXT NOT NULL,
        at                 TEXT NOT NULL,
        kind               TEXT NOT NULL,
        duration_seconds   INTEGER NOT NULL,
        countdown_seconds  INTEGER NOT NULL,
        created_by         TEXT,
        created_at         TEXT NOT NULL,

        CHECK (kind IN ('fullscreen', 'discreet')),
        -- No countdown for a discreet announcement (spec 21, rule 4).
        CHECK (kind = 'fullscreen' OR countdown_seconds = 0)
      );

      -- The wall's read (a window around now) and the host's list. Its first column is the
      -- foreign key's lookup.
      CREATE INDEX IF NOT EXISTS idx_event_announcements_event_at
        ON event_announcements (event_id, at);
  `,
}
