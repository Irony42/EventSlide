import type { Migration } from '../migrator'

/**
 * The mission a guest picked a video clip for.
 *
 * On the **job**, for the reason `trim_start_ms` is (025): nothing is filed while the request
 * is open. The `photos` row is written by the worker when the transcode has finished, and it
 * reads the mission from the row it claimed.
 *
 * Nullable with no default, so every job that exists and every upload that names no mission
 * answers none, with no backfill and no rebuild. `SET NULL` on delete, as `photos.mission_id`
 * is (005): a host removing a mission must not be blocked by a clip still in the queue, and the
 * clip then arrives untagged.
 *
 * The index is the foreign key's lookup when a mission is deleted (013's rule). Partial,
 * because the column is NULL for almost every job.
 */
export const migration027: Migration = {
  id: 27,
  name: 'clip_mission',
  sql: `
      ALTER TABLE clip_jobs
        ADD COLUMN mission_id TEXT REFERENCES event_missions (id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_clip_jobs_mission
        ON clip_jobs (mission_id)
        WHERE mission_id IS NOT NULL;
  `,
}
