import type { Migration } from '../migrator'

/**
 * Which part of a too-long recording to keep (spec 16).
 *
 * On the **job**, not passed along with the request, because nothing is encoded while the
 * request is open: the worker claims the row later, and whatever it needs to know about
 * the guest's choice has to be in the row.
 *
 * Both nullable, and both `NULL` for every job that exists today and for every upload that
 * sends no range. "Both or neither" is the entity's rule (`ClipJob`) and the repository
 * contract's; SQLite will not take a cross-column `CHECK` on `ADD COLUMN`.
 */
export const migration025: Migration = {
  id: 25,
  name: 'clip_trim',
  sql: `
      ALTER TABLE clip_jobs ADD COLUMN trim_start_ms INTEGER
        CHECK (trim_start_ms IS NULL OR trim_start_ms >= 0);

      ALTER TABLE clip_jobs ADD COLUMN trim_end_ms INTEGER
        CHECK (trim_end_ms IS NULL OR trim_end_ms > 0);
  `,
}
