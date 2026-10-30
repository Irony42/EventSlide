import type { Migration } from '../migrator'

/**
 * The operator's "remove without viewing" levers (docs/ROADMAP.md §10.6 to §10.8; launch review
 * S5, G8-03): three nullable instants, and nothing else.
 *
 * - **`photos.taken_down_at`**: the operator took this one photograph down, by its id, without
 *   opening it. A taken-down photograph is **not a status**: `status` is the host's moderation
 *   machine (pending, published, rejected, hidden) and a host can move a photograph through it
 *   in either direction, so a takedown folded into it would be undone by the next click. This is
 *   a second, independent fact that only the operator's routes write, and the photo repository's
 *   reads (`findById`, `list`, `listIdsByStatus`, `countsByStatus`) leave the row out, so no
 *   surface that reads a photograph through the port can serve it: the wall, the guest's feed,
 *   a gallery link, the host's grid and the media route all go through it.
 * - **`events.taken_down_at`**: the same for a whole event. Every surface that serves an event
 *   (the wall, a guest, a host, a gallery link, the join, an open stream) answers it as an event
 *   that does not exist.
 * - **`events.purge_held_at`**: a purge hold, for evidence preservation. The retention sweep skips
 *   a held event, and neither the host's purge nor the deletion of a photograph proceeds on one.
 *   Independent of the takedown on purpose: taking something down does not stop the retention
 *   clock, and holding does not hide anything.
 *
 * None of them is a free-text column. The operator's reason for each act lives in the audit log
 * (`audit_log.details`, the one bounded `reason`), and the instant is all the row needs to say.
 *
 * Nothing is backfilled and no row changes: every existing row reads as "not taken down, not
 * held". Partial indexes, because the rows they hold are the exception: the retention sweep asks
 * "is any held" of every due event, and an operator lists what is down.
 */
export const migration015: Migration = {
  id: 15,
  name: 'operator_takedown',
  sql: `
      ALTER TABLE photos ADD COLUMN taken_down_at TEXT;
      ALTER TABLE events ADD COLUMN taken_down_at TEXT;
      ALTER TABLE events ADD COLUMN purge_held_at TEXT;

      CREATE INDEX IF NOT EXISTS idx_photos_taken_down
        ON photos (event_id)
        WHERE taken_down_at IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_events_purge_held
        ON events (purge_held_at)
        WHERE purge_held_at IS NOT NULL;
    `,
}
