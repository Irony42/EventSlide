import type { Migration } from '../migrator'

/**
 * Guest replies, RSVP (spec 30, lot 1): what the host asks on the invitation, and what guests
 * answer.
 *
 * - **The settings live on the invitation** (`guest_invites`): the switch, the deadline (a local
 *   day, `YYYY-MM-DD`, read in the invitation's own `time_zone`), the host's manual closing and
 *   the form as JSON. A `NULL` form means "the defaults"; the domain restores it leniently.
 * - **`guest_rsvps`** holds one row per reply. `edit_token_hash` is the SHA-256 of the token the
 *   guest keeps (ADR 0017): the token itself is never stored, and a reply the host typed has none.
 *   `details` carries what lots 2 and 4 add (companions, meals, answers, moments, the wish to
 *   show a first name) so that no later lot needs to rebuild the table.
 * - **`waitlist` and `household` are in the `CHECK`s from the start**: SQLite cannot change a
 *   `CHECK` without rebuilding the table, and the households table only comes with 037 (hence
 *   no foreign key on `household_id`; the use case that deletes a household clears it).
 * - **Free text is health data in part** (`diet`, ADR 0017): it goes with the reply, and the reply
 *   goes with its event (`ON DELETE CASCADE`) or earlier, by the retention sweep.
 * - `event_memberships.rsvp_seen_at` is the host's "last visit to the replies page", which the
 *   badge counts from.
 *
 * Kept in one file so renumbering it after another migration lands is a two-line change.
 */
export const migration036: Migration = {
  id: 36,
  name: 'guest_rsvps',
  sql: `
      ALTER TABLE guest_invites ADD COLUMN rsvp_enabled   INTEGER NOT NULL DEFAULT 0
        CHECK (rsvp_enabled IN (0, 1));
      ALTER TABLE guest_invites ADD COLUMN rsvp_deadline  TEXT;
      ALTER TABLE guest_invites ADD COLUMN rsvp_closed_at TEXT;
      ALTER TABLE guest_invites ADD COLUMN rsvp_form      TEXT
        CHECK (rsvp_form IS NULL OR json_valid(rsvp_form));

      ALTER TABLE event_memberships ADD COLUMN rsvp_seen_at TEXT;

      CREATE TABLE IF NOT EXISTS guest_rsvps (
        id               TEXT PRIMARY KEY,
        event_id         TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
        household_id     TEXT,
        edit_token_hash  TEXT UNIQUE,
        name             TEXT NOT NULL,
        answer           TEXT NOT NULL,
        adults           INTEGER NOT NULL DEFAULT 0,
        kids             INTEGER NOT NULL DEFAULT 0,
        details          TEXT,
        diet             TEXT,
        message          TEXT,
        source           TEXT NOT NULL,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,

        CHECK (answer IN ('yes', 'maybe', 'no', 'waitlist')),
        CHECK (adults >= 0),
        CHECK (kids >= 0),
        CHECK (details IS NULL OR json_valid(details)),
        CHECK (source IN ('open', 'household', 'host'))
      );
      CREATE INDEX IF NOT EXISTS guest_rsvps_event ON guest_rsvps (event_id, updated_at);
  `,
}
