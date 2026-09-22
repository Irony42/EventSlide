import type { Migration } from '../migrator'

/**
 * Which privacy notice a guest's device acknowledged, and when (docs/ROADMAP.md §5.1).
 *
 * **Two columns on `guests`, not a table.** An acknowledgement is one fact about one
 * device at one event, and the `guests` row *is* that device: the HMAC token in the
 * `es_guest` cookie names it, and every other per-device fact — the display name, the
 * revocation, the presence clock — already lives on it. Only the latest acknowledgement is
 * kept, because the only question anything asks is "has this guest read the notice in
 * force?", and a history of every notice a phone has seen would be a record of guests
 * nobody needs to keep.
 *
 * **Stored server-side rather than in the browser, deliberately.** Whether a guest must
 * read the notice again is a comparison between what they read and what the event's
 * configuration says now, which is a rule, and rules belong in the domain rather than in a
 * `localStorage` key the client compares for itself. It also survives what browser
 * storage does not: the guest session is per tab (`sessionStorage`), so a guest who closes
 * the tab and re-scans the QR code is the same device to the server and would have been a
 * stranger to the page.
 *
 * `notice_revision` is the notice's own readable identity
 * (`publication=afterReview;audiences=wall+organisers;retention=30;selfRemoval=900`), so
 * "what was this guest told?" is answered by reading the column.
 *
 * **Both or neither**, enforced by the database: a revision with no instant is an
 * acknowledgement nobody can date, and an instant with no revision says a guest read
 * something without saying what. SQLite accepts a column `CHECK` that names another column
 * on `ADD COLUMN`, and both columns arrive `NULL` on every existing row, which satisfies it.
 *
 * **No backfill, on purpose.** A guest who joined before this migration was never shown a
 * notice, so they have not acknowledged one, and `NULL` is the truth: they are asked
 * before their next upload, once. Inventing an acknowledgement for them would be the
 * product claiming a guest was told something they were not.
 *
 * No index: the columns are read only through the primary key, with the row they belong
 * to.
 */
export const migration006: Migration = {
  id: 6,
  name: 'guest_notice_acknowledgement',
  sql: `
      ALTER TABLE guests ADD COLUMN notice_revision TEXT;

      ALTER TABLE guests ADD COLUMN notice_acknowledged_at TEXT
        CHECK ((notice_acknowledged_at IS NULL) = (notice_revision IS NULL));
    `,
}
