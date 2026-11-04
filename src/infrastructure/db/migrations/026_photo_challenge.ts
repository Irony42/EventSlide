import type { Migration } from '../migrator'

/**
 * A photograph answers a challenge by naming it (spec 18), not by naming its mission.
 *
 * Until now a challenge's answers were the published photographs that carried the challenge's
 * mission inside its time window, so a challenge needed a mission and a guest who tapped that
 * mission for another reason counted. Now the host types the challenge's own text and the
 * phone's "Je participe au défi" box sends the challenge's id: the photograph stores it, and
 * the count reads it (with the status and the operator's take-down, at read time).
 *
 * **`event_challenges` is not touched**: its `prompt` (frozen copy) and its nullable
 * `mission_id` already exist since 024, so no table is rebuilt. `ADD COLUMN ... REFERENCES` is
 * allowed because the default is NULL. `SET NULL` on delete: purging an event removes its
 * challenges and its photographs together, and nothing blocks. The column holds no guest data.
 *
 * No backfill: answers recorded by mission before this migration are not rewritten. A
 * challenge lasts 30 minutes at most and its count is shown for 20 seconds.
 * Kept in one file so renumbering it after another migration lands is a two-line change.
 */
export const migration026: Migration = {
  id: 26,
  name: 'photo_challenge',
  sql: `
      ALTER TABLE photos
        ADD COLUMN challenge_id TEXT REFERENCES event_challenges (id) ON DELETE SET NULL;

      -- The count of a challenge's answers, and the foreign key's lookup when one is deleted.
      CREATE INDEX IF NOT EXISTS idx_photos_challenge
        ON photos (challenge_id)
        WHERE challenge_id IS NOT NULL;
  `,
}
