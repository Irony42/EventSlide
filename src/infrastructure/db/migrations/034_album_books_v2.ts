import type { Migration } from '../migrator'

/**
 * The photo book v2 (spec 26): a plan, a printer version, a guest book.
 *
 * `album_books` is **rebuilt**, because two `CHECK` lists change and SQLite cannot alter one:
 * `stale_reason` gains `messageRemoved` (a guest-book message can void a book now). The new
 * table is created beside the old one, every row is copied, the old one is dropped and the
 * two indexes are recreated under their names. The foreign key to `events` and its
 * `ON DELETE CASCADE` are written again; nothing references `album_books`, so the drop
 * cascades to nothing.
 *
 * New columns:
 * - `plan_json`: the plan the render follows (ids and numbers, spec 26 section 5), `NULL`
 *   until a render starts and again after the book is voided. Validated by zod at both ends.
 * - `selected_count`: the photographs the plan kept. A 3.14 book kept every photograph it
 *   drew, so it is backfilled from `photo_count`.
 * - `print_byte_size`: the printer version's two files together, `NULL` when there is none.
 * - `print_skipped`: why a ready book has no printer version (`tooManyPages`, `tooLarge`).
 *
 * **`options_json` is rewritten for every row** into the v2 shape, the way
 * `legacyBookOptions` does (a 3.14 book is a Classique book with every photograph, no guest
 * book, no printer version, Paris time): the zod schema that reads it stays strict and unique.
 * `migrator.test.ts` holds this SQL to that function.
 *
 * Kept in one file so renumbering it after another migration lands is a two-line change.
 */
export const migration034: Migration = {
  id: 34,
  name: 'album_books_v2',
  sql: `
      DROP INDEX IF EXISTS idx_album_books_status;
      DROP INDEX IF EXISTS idx_album_books_expires;

      ALTER TABLE album_books RENAME TO album_books_before_034;

      CREATE TABLE album_books (
        event_id        TEXT    PRIMARY KEY REFERENCES events (id) ON DELETE CASCADE,
        status          TEXT    NOT NULL
                        CHECK (status IN ('queued', 'running', 'done', 'failed', 'stale')),
        options_json    TEXT    NOT NULL,
        requested_at    TEXT    NOT NULL,
        snapshot_at     TEXT    NOT NULL,
        invalidated_at  TEXT,
        started_at      TEXT,
        done_at         TEXT,
        photo_count     INTEGER CHECK (photo_count IS NULL OR photo_count >= 0),
        skipped_count   INTEGER CHECK (skipped_count IS NULL OR skipped_count >= 0),
        page_count      INTEGER CHECK (page_count IS NULL OR page_count >= 0),
        byte_size       INTEGER CHECK (byte_size IS NULL OR byte_size >= 0),
        expires_at      TEXT,
        failure_code    TEXT    CHECK (failure_code IS NULL
                                       OR failure_code IN ('unavailable', 'tooLarge', 'empty', 'unexpected')),
        stale_reason    TEXT    CHECK (stale_reason IS NULL
                                       OR stale_reason IN ('photoRemoved', 'captionChanged',
                                                           'messageRemoved', 'fileMissing')),
        plan_json       TEXT    CHECK (plan_json IS NULL OR json_valid(plan_json)),
        selected_count  INTEGER CHECK (selected_count IS NULL OR selected_count >= 0),
        print_byte_size INTEGER CHECK (print_byte_size IS NULL OR print_byte_size >= 0),
        print_skipped   TEXT    CHECK (print_skipped IS NULL
                                       OR print_skipped IN ('tooManyPages', 'tooLarge'))
      );

      INSERT INTO album_books (event_id, status, options_json, requested_at, snapshot_at,
                               invalidated_at, started_at, done_at, photo_count, skipped_count,
                               page_count, byte_size, expires_at, failure_code, stale_reason,
                               plan_json, selected_count, print_byte_size, print_skipped)
        SELECT event_id, status,
               json_object(
                 'title', json_extract(options_json, '$.title'),
                 'subtitle', json_extract(options_json, '$.subtitle'),
                 'language', json_extract(options_json, '$.language'),
                 'style', 'classique',
                 'selection', json_object('kind', 'all'),
                 'showAuthors',
                   json(CASE WHEN json_extract(options_json, '$.showAuthors') THEN 'true' ELSE 'false' END),
                 'showCaptions',
                   json(CASE WHEN json_extract(options_json, '$.showCaptions') THEN 'true' ELSE 'false' END),
                 'includeGuestbook', json('false'),
                 'printVersion', json('false'),
                 'timeZone', 'Europe/Paris'
               ),
               requested_at, snapshot_at, invalidated_at, started_at, done_at, photo_count,
               skipped_count, page_count, byte_size, expires_at, failure_code, stale_reason,
               NULL, photo_count, NULL, NULL
          FROM album_books_before_034;

      DROP TABLE album_books_before_034;

      CREATE INDEX idx_album_books_status  ON album_books (status, requested_at);
      CREATE INDEX idx_album_books_expires ON album_books (expires_at)
        WHERE expires_at IS NOT NULL;
    `,
}
