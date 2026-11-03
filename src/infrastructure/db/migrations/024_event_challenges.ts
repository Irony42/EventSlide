import type { Migration } from '../migrator'

/**
 * Timed photo challenges (spec 10): a host launches one of the event's missions for a few
 * minutes, and the wall and the phones count down together.
 *
 * **A table, and not a key of `events.settings`.** A challenge is a race state, not a
 * setting: `PATCH /settings` reads and rewrites the whole blob, so two hosts starting and
 * stopping would lose one another's update, and the history of the evening (and the final
 * count) lives better in rows. Nothing is added to `EventSettings`.
 *
 * **There is no "running" column, and no timer.** A challenge runs while `now < ends_at`
 * and `ended_at IS NULL`; the end is derived from the clock, so no job has to fire and a
 * restart in the middle of a challenge changes nothing. `ended_at` is only a host's early
 * stop. Answers are not stored either: they are the published photographs that name the
 * mission inside the window, counted at read time (the same derivation as a mission's
 * progress, migration 005).
 *
 * **At most one open challenge per event is not expressible as an index**, because "open"
 * depends on the time. The adapter holds it in one synchronous transaction (read the last
 * challenge, then insert).
 *
 * `prompt` is a frozen copy: correcting the mission later must not change a sentence the
 * room is reading. `mission_id` is `SET NULL` on delete, and `deleteMission` stops the
 * challenge in the same breath. `created_by` is a host account id, never a guest's, and has
 * no foreign key: a challenge keeps no personal data and need not follow a user's deletion.
 * Kept in one file so renumbering it after another migration lands is a two-line change.
 */
export const migration024: Migration = {
  id: 24,
  name: 'event_challenges',
  sql: `
      CREATE TABLE IF NOT EXISTS event_challenges (
        id          TEXT PRIMARY KEY,
        event_id    TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
        mission_id  TEXT REFERENCES event_missions (id) ON DELETE SET NULL,
        prompt      TEXT NOT NULL,
        started_at  TEXT NOT NULL,
        ends_at     TEXT NOT NULL,
        ended_at    TEXT,
        created_by  TEXT
      );

      -- The last challenge of an event, and the count of its history.
      CREATE INDEX IF NOT EXISTS idx_event_challenges_event
        ON event_challenges (event_id, started_at DESC);

      -- The foreign key's lookup when a mission is deleted. Partial: the column is NULL
      -- once its mission is gone.
      CREATE INDEX IF NOT EXISTS idx_event_challenges_mission
        ON event_challenges (mission_id)
        WHERE mission_id IS NOT NULL;
  `,
}
