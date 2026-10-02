import type { Migration } from '../migrator'

/**
 * Clients as records, not a convention (docs/ROADMAP.md §10.2; paid plan P3-04).
 *
 * An event already has an `owner_id`; a client is, until this migration, the *pattern*
 * of one person owning several events, which nothing enforces and nothing can query.
 * This gives that pattern a table: a name, a contact, a lifecycle, and the ceilings
 * every later §10 item hangs off — an invitation is to a client's event, suspension is
 * of a client, a byte ceiling is a client's own.
 *
 * ## The full D-05 catalogue, in this one migration
 *
 * Every ceiling column the paid plan's beta catalogue (D-05) ever charges for is here
 * from the first row — `live_allowed`, `max_live_days`, `max_events_per_period`,
 * `period_started_at`, `events_created_in_period`, `locale` on `clients`, and
 * `events.opened_at` — even though the free plan's own use cases (`createClient`,
 * `renameClient`, `setClientCeilings`, `listClients`, `deleteEmptyClient`) touch only a
 * few of them. Migrations are append-only, so a column missed here is a second
 * migration; the paid plan reuses this one verbatim rather than adding its own.
 *
 * ## `events.client_id`, nullable and `ON DELETE RESTRICT`
 *
 * Added here, used starting at G2-04/P3-05. `RESTRICT` rather than `CASCADE` or
 * `SET NULL`: deleting a client that still owns an event must fail loudly rather than
 * either take the event's photographs with it or silently orphan them. Nullable because
 * every event on a free-tier, no-`SITE_ADMIN` install has no client at all — "ceilings
 * are enforced from the data, not from the switch" (roadmap §10.9) depends on that being
 * a legitimate, permanent state rather than a value nothing produces.
 *
 * **No backfill of existing events**, by design (roadmap A-27 / P4-11): there is no
 * client row to attach an event created before this migration to, and inventing one
 * would assign somebody else's wedding to an account they never agreed to.
 *
 * ## `client_members`, the client's own roster
 *
 * Deliberately a second table from `event_memberships`, not a union of the two. A
 * `ClientRole` (`owner` / `member`) answers "who manages this account" and an
 * `EventRole` answers "who may moderate this one evening" — ranking them together would
 * be exactly the permission matrix roadmap §10.1 already refused to build for site roles.
 * `ON DELETE CASCADE` both ways: a deleted client takes its own roster with it, and a
 * deleted account loses every client membership it held, the same as `event_memberships`.
 *
 * ## Bounds copied verbatim from `ClientCeilings`
 *
 * Every numeric ceiling's `CHECK` matches `src/domain/clients/clientCeilings.ts` bound
 * for bound, so the database refuses nothing the domain would accept and accepts nothing
 * the domain would refuse: `max_retention_days` 1–3650, `max_live_days` 1–365, every
 * other ceiling a bare positive integer, `NULL` meaning "no ceiling" throughout.
 *
 * ## No index on `clients.name` or `clients.contact_email`
 *
 * Neither is ever looked up by value: the operator console (§10.4) lists clients by
 * `created_at`, and a client is otherwise always reached by id.
 */
export const migration008: Migration = {
  id: 8,
  name: 'clients',
  sql: `
      CREATE TABLE IF NOT EXISTS clients (
        id                        TEXT    PRIMARY KEY,
        name                      TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
        contact_email             TEXT,
        created_at                TEXT    NOT NULL,
        suspended_at              TEXT,
        -- Posed by offboardClient (roadmap §10.7 / P3-13), not this pull request.
        purge_after               TEXT,

        max_events                INTEGER CHECK (max_events IS NULL OR max_events > 0),
        max_total_bytes           INTEGER CHECK (max_total_bytes IS NULL OR max_total_bytes > 0),
        max_event_quota_bytes     INTEGER CHECK (max_event_quota_bytes IS NULL
                                                  OR max_event_quota_bytes > 0),
        max_retention_days        INTEGER CHECK (max_retention_days IS NULL
                                                  OR max_retention_days BETWEEN 1 AND 3650),
        -- Start of the retention-cap notice clock (roadmap §10.5 / P3-06), posed whenever
        -- max_retention_days is lowered. Not this pull request's own concern either.
        retention_cap_since       TEXT,

        clips_allowed             INTEGER NOT NULL DEFAULT 1 CHECK (clips_allowed IN (0, 1)),
        -- 0: quarantine, or a Pass that has expired (RK2.6).
        live_allowed              INTEGER NOT NULL DEFAULT 1 CHECK (live_allowed IN (0, 1)),
        max_live_days             INTEGER CHECK (max_live_days IS NULL
                                                  OR max_live_days BETWEEN 1 AND 365),
        max_events_per_period     INTEGER CHECK (max_events_per_period IS NULL
                                                  OR max_events_per_period > 0),
        -- A renewal moves this forward and resets the counter below (setClientCeilings).
        period_started_at        TEXT,
        -- Never decremented when an event is deleted: create, delete, recreate must not
        -- bypass the per-period ceiling.
        events_created_in_period INTEGER NOT NULL DEFAULT 0
                                  CHECK (events_created_in_period >= 0),

        -- The language a client's own system mail is written in (P3-08), distinct from
        -- any event's wallLanguage, which is a projector's policy and not a person's.
        locale                    TEXT    NOT NULL DEFAULT 'fr'
                                  CHECK (locale IN ('fr', 'en', 'de', 'es', 'it'))
      );

      -- ---------------------------------------------------------- client_members --
      -- The client's own roster: who may manage the account, as opposed to who may
      -- moderate one of its events (event_memberships, untouched by this migration).
      CREATE TABLE IF NOT EXISTS client_members (
        client_id   TEXT NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
        user_id     TEXT NOT NULL REFERENCES users (id)   ON DELETE CASCADE,
        role        TEXT NOT NULL CHECK (role IN ('owner', 'member')),
        granted_at  TEXT NOT NULL,
        PRIMARY KEY (client_id, user_id)
      );

      -- "Which client accounts is this user part of" — the dashboard's own lookup,
      -- mirroring idx_memberships_user over event_memberships.
      CREATE INDEX IF NOT EXISTS idx_client_members_user ON client_members (user_id, client_id);

      -- -------------------------------------------------------------------- events --
      -- RESTRICT: deleting a client that still owns an event must fail loudly rather
      -- than cascade its photographs away or silently orphan them. Nullable: every event
      -- on a free-tier install has no client at all, which is a permanent state and not
      -- a value nothing produces (roadmap §10.9). No backfill — see the file comment.
      ALTER TABLE events ADD COLUMN client_id TEXT REFERENCES clients (id) ON DELETE RESTRICT;

      -- First transition draft -> live (roadmap §10.5 / P3-06's max_live_days deadline).
      ALTER TABLE events ADD COLUMN opened_at TEXT;

      CREATE INDEX IF NOT EXISTS idx_events_client ON events (client_id);
  `,
}
