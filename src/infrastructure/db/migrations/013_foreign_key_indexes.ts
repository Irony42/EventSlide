import type { Migration } from '../migrator'

/**
 * An index that leads with the column of every foreign key whose parent row the product
 * deletes (code review of the infrastructure layer, I-01).
 *
 * Deleting a parent row makes SQLite look up its children by the foreign-key column: to
 * cascade, to null the column out, or to refuse. Without an index that leads with that
 * column the lookup reads the whole child table, across every event, once per deleted
 * parent. Purging an event (hourly, by the retention sweep, and when a host deletes one)
 * cascades to its guests, and each guest then cost a scan of `photos`, of `reactions` and
 * of `clip_jobs`: measured on this schema, 30 events of 100 guests and 1,000 photographs
 * each took 320 ms to purge one event, and 5 ms with the indexes below. `better-sqlite3` is
 * synchronous, so that is 320 ms in which no other event's upload, heartbeat or wall
 * refetch is served, per event purged, on the box that hosts many of them.
 *
 * - **`photos (author_guest_id)`, `reactions (guest_id)`, `clip_jobs (author_guest_id)`**:
 *   what a deleted guest (revoking one, or purging their event) cascades through.
 *   `idx_photos_event_author` and `idx_reactions_guest_recent` both carry the column, but
 *   behind `event_id`, which the lookup does not know.
 * - **`photos (mission_id)`**: deleting a mission, or purging the event it belongs to,
 *   unfiles the photographs tagged with it (`ON DELETE SET NULL`).
 * - **`account_tokens (event_id)`**: purging an event takes the invitations to it.
 *
 * The three nullable columns are partial, `WHERE column IS NOT NULL`, like
 * `idx_account_tokens_client` in 012: a photograph is written by a guest or by a host and a
 * clip job likewise, so half the rows would be index entries nobody looks up, and SQLite
 * uses a partial index for an equality lookup on the column. `reactions.guest_id` is
 * `NOT NULL` and is a plain index.
 *
 * What stays unindexed, on purpose: the foreign keys that point at `users`. No code path
 * deletes an account (it is switched off, `users.disabled_at`), so nothing looks those
 * children up. `migrator.test.ts` holds the list, with this reason, and fails on any other
 * foreign-key column that leads no index, so the day an account can be deleted the same
 * test asks for them.
 *
 * Nothing is backfilled and no row changes: an index is built from the rows already there.
 * Every new index costs one more entry per write to its table, which is why the list stops
 * at the lookups above.
 */
export const migration013: Migration = {
  id: 13,
  name: 'foreign_key_indexes',
  sql: `
      CREATE INDEX IF NOT EXISTS idx_photos_author_guest
        ON photos (author_guest_id)
        WHERE author_guest_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_photos_mission
        ON photos (mission_id)
        WHERE mission_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_reactions_guest
        ON reactions (guest_id);

      CREATE INDEX IF NOT EXISTS idx_clip_jobs_author_guest
        ON clip_jobs (author_guest_id)
        WHERE author_guest_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_account_tokens_event
        ON account_tokens (event_id)
        WHERE event_id IS NOT NULL;
  `,
}
