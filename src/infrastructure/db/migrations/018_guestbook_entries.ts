import type { Migration } from '../migrator'

/**
 * The guestbook (docs/ROADMAP.md 2.4; spec 01): written messages guests leave an event, moderated
 * like photographs.
 *
 * **One table, and it is the whole migration.** A message is a small thing a guest creates and a
 * moderator judges, so it is a row of its own rather than another key in `events.settings` (a
 * blob read whole, never queried) or a column on `photos` (a message has no bytes, no hash, no
 * dimensions). The two settings that govern it, `allowGuestbook` and `guestbookOnWall`, live in
 * that blob and need no migration: an event that predates them reads them through
 * `settingsBooleanAddedLater`.
 *
 * It carries the same moderation facts as `photos` (`status`, `review_kind`, `reviewed_at`,
 * `reviewed_by_user_id`) under the same constraints, because the domain borrows the photograph's
 * state machine whole, and the same `taken_down_at` the operator's takedown writes
 * (migration 015): a second, independent fact that the repository's reads leave out.
 *
 * ## Cascades
 *
 * `event_id` and `guest_id` both cascade: deleting an event (the retention purge) or a guest (their
 * erasure) removes the messages in the same transaction, with no byte to clean up. The erasure
 * code does not rely on it for a message the operator took down, which it must keep (see
 * `eraseGuestContribution`); the cascade is the net, not the mechanism.
 *
 * ## The indexes, and why each one leads the way it does
 *
 * - `(event_id, status, created_at, id)`: every read is "this event's messages in this status, in
 *   order" (the host's queue, the wall's published ones).
 * - `(guest_id)`: **must lead with the foreign key**. Deleting a guest makes SQLite look their
 *   rows up by that column, and an index starting with `event_id` does not serve it
 *   (`migrator.test.ts` plans the lookup of every foreign key and fails by name).
 * - `(reviewed_by_user_id)`: the same rule for the key to `users`, partial because most rows have
 *   none.
 * - `(event_id) WHERE taken_down_at IS NOT NULL`: what an operator lists is the exception.
 */
export const migration018: Migration = {
  id: 18,
  name: 'guestbook_entries',
  sql: `
      CREATE TABLE IF NOT EXISTS guestbook_entries (
        id                  TEXT PRIMARY KEY,
        event_id            TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
        guest_id            TEXT NOT NULL REFERENCES guests (id) ON DELETE CASCADE,

        -- Plain text, already cleaned and bounded by GuestbookText (500 characters, eight lines).
        body                TEXT NOT NULL,

        status              TEXT NOT NULL CHECK (status IN ('pending', 'published', 'rejected', 'hidden')),
        review_kind         TEXT CHECK (review_kind IN ('host', 'automatic')),
        reviewed_at         TEXT,
        reviewed_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,

        created_at          TEXT NOT NULL,
        taken_down_at       TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_guestbook_event_status
        ON guestbook_entries (event_id, status, created_at, id);

      CREATE INDEX IF NOT EXISTS idx_guestbook_guest
        ON guestbook_entries (guest_id);

      CREATE INDEX IF NOT EXISTS idx_guestbook_reviewed_by
        ON guestbook_entries (reviewed_by_user_id)
        WHERE reviewed_by_user_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_guestbook_taken_down
        ON guestbook_entries (event_id)
        WHERE taken_down_at IS NOT NULL;
  `,
}
