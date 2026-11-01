import type { Migration } from '../migrator'

/**
 * The photo book (spec 04): a PDF of the published album, made by the host.
 *
 * **`album_books`: one row per event** (the primary key is the foreign key, so a new book
 * replaces the old one and the cascade removes it with the event). The row is the state of
 * the render and the measures of the finished file; it holds **no guest text**: captions and
 * first names are read again when the book is rendered. `options_json` is the host's own
 * choices (title, subtitle, language, layout, switches) and is parsed with zod on both sides.
 * `invalidated_at` is the latest fact that made the book void, which the worker compares with
 * `started_at` when a render ends (a photo erased *during* the render must not be delivered).
 * `failure_code` and `stale_reason` are closed lists, never free text.
 *
 * **`album_book_requests`: one row per request**, what the "three books per event per day"
 * ceiling counts. It is separate from `album_books` on purpose: that row is replaced by every
 * request and deleted by the host, so a counter kept on it could be reset by deleting the
 * book. Rows go with the event.
 *
 * **`clients.books_allowed`** is the per-client switch (`NEW_CLIENT_BOOKS_ALLOWED`, like
 * `clips_allowed`): `1` for every existing client, so the function stays on until an
 * operator turns it off for one.
 *
 * Kept in one file so renumbering it after another migration lands is a two-line change.
 */
export const migration022: Migration = {
  id: 22,
  name: 'album_books',
  sql: `
      ALTER TABLE clients ADD COLUMN books_allowed INTEGER NOT NULL DEFAULT 1
        CHECK (books_allowed IN (0, 1));

      CREATE TABLE IF NOT EXISTS album_books (
        event_id       TEXT    PRIMARY KEY REFERENCES events (id) ON DELETE CASCADE,
        status         TEXT    NOT NULL
                       CHECK (status IN ('queued', 'running', 'done', 'failed', 'stale')),
        options_json   TEXT    NOT NULL,
        requested_at   TEXT    NOT NULL,
        snapshot_at    TEXT    NOT NULL,
        invalidated_at TEXT,
        started_at     TEXT,
        done_at        TEXT,
        photo_count    INTEGER CHECK (photo_count IS NULL OR photo_count >= 0),
        skipped_count  INTEGER CHECK (skipped_count IS NULL OR skipped_count >= 0),
        page_count     INTEGER CHECK (page_count IS NULL OR page_count >= 0),
        byte_size      INTEGER CHECK (byte_size IS NULL OR byte_size >= 0),
        expires_at     TEXT,
        failure_code   TEXT    CHECK (failure_code IS NULL
                                      OR failure_code IN ('unavailable', 'tooLarge', 'empty', 'unexpected')),
        stale_reason   TEXT    CHECK (stale_reason IS NULL
                                      OR stale_reason IN ('photoRemoved', 'captionChanged', 'fileMissing'))
      );

      -- The worker's claim and the recovery at boot read by status; the sweep by expiry.
      CREATE INDEX IF NOT EXISTS idx_album_books_status  ON album_books (status, requested_at);
      CREATE INDEX IF NOT EXISTS idx_album_books_expires ON album_books (expires_at)
        WHERE expires_at IS NOT NULL;

      CREATE TABLE IF NOT EXISTS album_book_requests (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id     TEXT    NOT NULL REFERENCES events (id) ON DELETE CASCADE,
        requested_at TEXT    NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_album_book_requests_event
        ON album_book_requests (event_id, requested_at);
    `,
}
