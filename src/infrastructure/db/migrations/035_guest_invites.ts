import type { Migration } from '../migrator'

/**
 * Guest invitations (spec 29): the invitation a host sends before the party, behind a link.
 *
 * **A table, and not a key of `events.settings`**: the public page reads by token (the unique
 * index below), and the content (an address, a personal word) has no business in the settings
 * blob that the wall and the guests' interface receive. At most one row per event
 * (`event_id` is the primary key, which is also the foreign key's lookup).
 *
 * - `token` is stored **in the clear** (ADR 0016): the host must be able to show the link again.
 *   `UNIQUE` is the lookup index of the public page.
 * - `enabled` is a switch, not a deletion: turning it off keeps the token, so the same link comes
 *   back when the host turns it on again.
 * - Instants are ISO 8601 UTC text, like every other column; `time_zone` is the IANA identifier
 *   the invitation is read in. The text columns are nullable: they are filled as the host writes.
 *   The bounds are the domain's, not repeated here; only the closed vocabularies are.
 * - Rows go with their event (`ON DELETE CASCADE`), which is also how a purge and an operator's
 *   removal reach them.
 *
 * Kept in one file so renumbering it after another migration lands is a two-line change.
 */
export const migration035: Migration = {
  id: 35,
  name: 'guest_invites',
  sql: `
      CREATE TABLE IF NOT EXISTS guest_invites (
        event_id    TEXT PRIMARY KEY REFERENCES events (id) ON DELETE CASCADE,
        token       TEXT NOT NULL UNIQUE,
        enabled     INTEGER NOT NULL DEFAULT 0,
        title       TEXT,
        starts_at   TEXT,
        ends_at     TEXT,
        time_zone   TEXT,
        venue_name  TEXT,
        address     TEXT,
        message     TEXT,
        language    TEXT NOT NULL,
        updated_at  TEXT NOT NULL,

        CHECK (enabled IN (0, 1)),
        CHECK (language IN ('fr', 'de', 'en', 'es', 'it'))
      );
  `,
}
