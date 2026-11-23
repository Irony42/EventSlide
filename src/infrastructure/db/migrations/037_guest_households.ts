import type { Migration } from '../migrator'

/**
 * The guest list's households (spec 30, lot 3): a family or a couple the host listed, with the
 * places kept for them and a **personal link** of their own.
 *
 * - **`token` is stored in the clear** (ADR 0017), unlike a reply's token: the host shows the link
 *   again, to copy it or to print it on a card. It is a bearer credential of the invitation's kind
 *   (16 Crockford base32 characters, 80 bits, hence `CHECK (length(token) = 16)`) and `UNIQUE`, so a
 *   lookup is an index seek; every read also names the event.
 * - **`places`** is what the host keeps for the household (the reply's ceiling); the table's
 *   `CHECK`s repeat the domain's bounds so no writer can break them.
 * - **`moments`** holds the ids of the moments the household is invited to (lot 4), `NULL` for
 *   all of them. Nothing writes it yet.
 * - **`reminded_at`** is the host's own note "relancé le": EventSlide sends nothing.
 * - A household goes with its event (`ON DELETE CASCADE`) or earlier, by the retention sweep.
 *
 * What this migration does **not** do:
 *
 * - **No foreign key on `guest_rsvps.household_id`**: `ALTER TABLE` cannot add one. The use case
 *   that deletes a household detaches its reply first.
 * - **No unique index for "one reply per household"**: `guest_rsvps_household (event_id,
 *   household_id) WHERE household_id IS NOT NULL` already exists since 036.
 *
 * Kept in one file so renumbering it after another migration lands is a two-line change.
 */
export const migration037: Migration = {
  id: 37,
  name: 'guest_households',
  sql: `
      CREATE TABLE IF NOT EXISTS guest_households (
        id          TEXT PRIMARY KEY,
        event_id    TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
        token       TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL,
        places      INTEGER NOT NULL,
        moments     TEXT,
        reminded_at TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,

        CHECK (length(name) BETWEEN 1 AND 80),
        CHECK (length(token) = 16),
        CHECK (places BETWEEN 1 AND 10),
        CHECK (moments IS NULL OR json_valid(moments))
      );
      CREATE INDEX IF NOT EXISTS guest_households_event ON guest_households (event_id, created_at);
  `,
}
