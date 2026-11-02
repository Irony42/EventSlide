import type { Migration } from '../migrator'

/**
 * The event's highlight reel (spec 08, best-of, step 2): one MP4 montage of the host's favourites.
 *
 * **One row per event**, by the unique index: asking for a new montage reuses the row, so the old
 * file can be replaced and never counted twice. `photo_ids` is a JSON snapshot (at most 120 ids)
 * read and written as a whole; invalidation loads the one row of the event and tests membership in
 * memory, never with a JSON query. `output_hash`, `byte_size` and `duration_ms` describe the file
 * while there is one: a finished montage, and a stale one until its file is deleted. They are what
 * the event's byte quota counts (`eventHoldingBytesSum`).
 *
 * Deleting an event cascades to its row. The file goes with the event's media directory.
 */
export const migration021: Migration = {
  id: 21,
  name: 'highlight_reels',
  sql: `
      CREATE TABLE highlight_reels (
        id           TEXT PRIMARY KEY,
        event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        status       TEXT NOT NULL
                       CHECK (status IN ('queued', 'running', 'done', 'failed', 'stale')),
        photo_ids    TEXT NOT NULL,
        attempts     INTEGER NOT NULL DEFAULT 0,
        not_before   TEXT NOT NULL,
        failure_code TEXT,
        output_hash  TEXT CHECK (output_hash IS NULL OR length(output_hash) = 64),
        byte_size    INTEGER,
        duration_ms  INTEGER,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );

      CREATE UNIQUE INDEX uq_highlight_reels_event ON highlight_reels (event_id);
      CREATE INDEX idx_highlight_reels_claim ON highlight_reels (status, not_before);
  `,
}
