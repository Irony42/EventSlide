import type { Migration } from '../migrator'

/**
 * The host's favourites (spec 08, best-of): a nullable instant per photograph.
 *
 * `NULL` is "not a favourite". Like `taken_down_at` (015), the column is not written by the
 * repository's `save`, so a stale read of a moderation cannot erase a star set in between;
 * `setHighlighted` writes it, and a transition out of `published` clears it. The partial index
 * keeps the favourites query small on an event with tens of thousands of photographs.
 */
export const migration020: Migration = {
  id: 20,
  name: 'photo_highlights',
  sql: `
      ALTER TABLE photos ADD COLUMN highlighted_at TEXT;

      CREATE INDEX IF NOT EXISTS idx_photos_event_highlighted
        ON photos (event_id, highlighted_at)
        WHERE highlighted_at IS NOT NULL;
  `,
}
