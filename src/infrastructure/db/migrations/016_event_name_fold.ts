import type { Migration } from '../migrator'

/**
 * An indexed, folded copy of an event's name, for the operator's lookup (launch review S5;
 * `EventRepository.listByName`).
 *
 * The lookup matches an **exact** name ignoring case, accents and blanks. SQLite's `lower()` folds
 * ASCII only, so the first version folded in a registered JavaScript function and compared it to the
 * query: correct, and a scan of the whole table on the event loop, per lookup. This column holds
 * the fold (`foldName`, `domain/events/eventName.ts`) so the lookup is an index seek.
 *
 * **SQL cannot compute the fold** (it drops accents with Unicode normalisation), so this migration
 * adds the column and the index and nothing else: the repository writes the fold on every `save`
 * and `createWithOwner`, and fills it for rows that predate this column when it is constructed
 * (`SqliteEventRepository`, once, for the rows where it is `NULL`). A row whose fold is `NULL` is
 * simply not found by name until then, and by slug or join code as always.
 */
export const migration016: Migration = {
  id: 16,
  name: 'event_name_fold',
  sql: `
      ALTER TABLE events ADD COLUMN name_fold TEXT;

      CREATE INDEX IF NOT EXISTS idx_events_name_fold ON events (name_fold);
    `,
}
