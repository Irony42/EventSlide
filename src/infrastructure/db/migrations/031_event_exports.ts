import type { Migration } from '../migrator'

/**
 * The one verified archive of an event, prepared on the box for the host to download (spec 22).
 *
 * One row per event, replaced by a new request. The file it names lives at
 * `<MEDIA_ROOT>/.exports/<event id>.zip`, outside the event's folder and outside the backups, and
 * dies with the album: the row goes with its event (`ON DELETE CASCADE`), which is how the retention
 * purge, an offboarding and an operator's removal all reach it, and the purge deletes the file next
 * to the row. No guest's data is stored: the archive's contents are read again from the album when
 * it is written, and `failure` and `stale_reason` are closed codes, never free text.
 *
 * **`event_export_requests`** is what the daily ceiling counts (`EXPORT_MAX_PER_EVENT_PER_DAY`), in
 * a table of its own for the reason `album_book_requests` is: replacing or deleting the archive must
 * not reset the count. It goes with its event as well.
 *
 * Every foreign key has an index that starts with its column: the primary keys start with
 * `event_id`, and `requested_by` has its own.
 */
export const migration031: Migration = {
  id: 31,
  name: 'event_exports',
  sql: `
      CREATE TABLE IF NOT EXISTS event_exports (
        event_id       TEXT PRIMARY KEY REFERENCES events (id) ON DELETE CASCADE,
        status         TEXT NOT NULL CHECK (status IN ('queued', 'running', 'sealed', 'stale', 'failed')),
        requested_at   TEXT NOT NULL,
        requested_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
        started_at     TEXT,
        sealed_at      TEXT,
        expires_at     TEXT,
        entries        INTEGER CHECK (entries IS NULL OR entries >= 0),
        skipped        INTEGER CHECK (skipped IS NULL OR skipped >= 0),
        bytes          INTEGER CHECK (bytes IS NULL OR bytes >= 0),
        sha256         TEXT    CHECK (sha256 IS NULL OR length(sha256) = 64),
        served_at      TEXT,
        stale_reason   TEXT    CHECK (stale_reason IS NULL OR stale_reason IN (
                                 'photoRemoved', 'guestErased', 'guestbookChanged', 'takenDown',
                                 'reopened', 'albumChanged', 'fileMissing')),
        invalidated_at TEXT,
        failure        TEXT    CHECK (failure IS NULL OR failure IN (
                                 'corrupt', 'noRoom', 'tooLarge', 'unavailable', 'unverified',
                                 'unexpected'))
      );

      CREATE INDEX IF NOT EXISTS idx_event_exports_requested_by ON event_exports (requested_by);
      CREATE INDEX IF NOT EXISTS idx_event_exports_expiry ON event_exports (expires_at)
        WHERE status = 'sealed';

      CREATE TABLE IF NOT EXISTS event_export_requests (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id     TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
        requested_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_event_export_requests_event
        ON event_export_requests (event_id, requested_at);
  `,
}
