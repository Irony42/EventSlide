import type { Migration } from '../migrator'

/**
 * The 2.0 schema.
 *
 * Conventions, applied everywhere and enforced by review:
 * - Primary keys are application-generated opaque `TEXT`, never `AUTOINCREMENT`. Ids
 *   appear in URLs, and 1.0's integer keys meant `/admin/getpic/3` invited `/4`.
 * - Timestamps are ISO-8601 UTC `TEXT`. They sort lexicographically, they are readable
 *   in a `.dump`, and there is no timezone ambiguity. The one exception is
 *   `sessions.expires_at`, noted where it is declared.
 * - Booleans are `INTEGER` 0/1, because SQLite has no boolean type.
 * - Every event-scoped table carries `event_id ... ON DELETE CASCADE` and an index
 *   leading with `event_id`, because every query in the application filters on it.
 * - Closed sets get a `CHECK` constraint as well as domain validation. Defence in
 *   depth, and the column documents itself in a schema dump.
 */
export const migration001: Migration = {
  id: 1,
  name: 'initial_schema',
  up: (db) => {
    db.exec(`
      -- ------------------------------------------------------------------ users --
      -- Hosts and moderators. Guests are NOT users; see the guests table.
      CREATE TABLE IF NOT EXISTS users (
        id                    TEXT    PRIMARY KEY,
        email                 TEXT    NOT NULL,
        display_name          TEXT,
        password_hash         TEXT    NOT NULL,
        created_at            TEXT    NOT NULL,
        last_login_at         TEXT,
        must_change_password  INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
        disabled_at           TEXT
      );

      -- Stored already lowercased by EmailAddress, so this index is usable for lookup
      -- rather than needing COLLATE NOCASE.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);

      -- ----------------------------------------------------------------- events --
      CREATE TABLE IF NOT EXISTS events (
        id           TEXT    PRIMARY KEY,
        -- RESTRICT, not CASCADE: deleting a host must not silently take a wedding
        -- album with it. Ownership is transferred first, deliberately.
        owner_id     TEXT    NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
        name         TEXT    NOT NULL,
        slug         TEXT    NOT NULL,
        join_code    TEXT    NOT NULL,
        status       TEXT    NOT NULL CHECK (status IN ('draft', 'live', 'closed', 'archived')),
        -- EventSettings as JSON. Settings are read as a whole with the aggregate and
        -- never queried field by field, so a column per setting would be nine
        -- migrations for no benefit.
        settings     TEXT    NOT NULL,
        quota_bytes  INTEGER NOT NULL CHECK (quota_bytes > 0),
        created_at   TEXT    NOT NULL,
        starts_at    TEXT,
        closed_at    TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_events_slug      ON events (slug);
      -- Unique across all events: a join code is resolved without knowing the event,
      -- so a collision would send guests to the wrong party.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_events_join_code ON events (join_code);
      CREATE INDEX IF NOT EXISTS idx_events_owner            ON events (owner_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_events_status_closed    ON events (status, closed_at);

      -- ------------------------------------------------------ event_memberships --
      -- Roles are per event. 1.0 had a single partyId column on the user row, so a
      -- user belonged to exactly one party and there was no notion of a role.
      CREATE TABLE IF NOT EXISTS event_memberships (
        event_id    TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
        user_id     TEXT NOT NULL REFERENCES users (id)  ON DELETE CASCADE,
        role        TEXT NOT NULL CHECK (role IN ('owner', 'moderator')),
        granted_at  TEXT NOT NULL,
        PRIMARY KEY (event_id, user_id)
      );

      -- The dashboard lists a user's events; the PK covers the authorization lookup.
      CREATE INDEX IF NOT EXISTS idx_memberships_user ON event_memberships (user_id, event_id);

      -- ----------------------------------------------------------------- guests --
      -- An anonymous, event-scoped device identity. A guest row is what a signed
      -- device token names, which is what makes a guest's upload attributable and
      -- revocable without an account.
      CREATE TABLE IF NOT EXISTS guests (
        id            TEXT PRIMARY KEY,
        event_id      TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
        display_name  TEXT,
        joined_at     TEXT NOT NULL,
        last_seen_at  TEXT NOT NULL,
        revoked_at    TEXT
      );

      -- "Who is at the party right now" and the guest list, both event-scoped.
      CREATE INDEX IF NOT EXISTS idx_guests_event_seen ON guests (event_id, last_seen_at DESC);

      -- ----------------------------------------------------------------- photos --
      CREATE TABLE IF NOT EXISTS photos (
        id                   TEXT    PRIMARY KEY,
        event_id             TEXT    NOT NULL REFERENCES events (id) ON DELETE CASCADE,

        -- Exactly one author. CASCADE on the guest is the erasure path: deleting a
        -- guest row removes their photos. The use case deletes their media files
        -- first, since the filesystem is not part of this transaction.
        author_guest_id      TEXT    REFERENCES guests (id) ON DELETE CASCADE,
        author_user_id       TEXT    REFERENCES users (id)  ON DELETE CASCADE,

        status               TEXT    NOT NULL
                                     CHECK (status IN ('pending', 'published', 'rejected', 'hidden')),
        -- SHA-256 of the stored bytes: the storage key, the idempotency key, and what
        -- makes an immutable cache header safe.
        content_hash         TEXT    NOT NULL CHECK (length(content_hash) = 64),
        width                INTEGER NOT NULL CHECK (width  > 0),
        height               INTEGER NOT NULL CHECK (height > 0),
        byte_size            INTEGER NOT NULL CHECK (byte_size > 0),
        caption              TEXT,
        created_at           TEXT    NOT NULL,

        -- The moderation decision. 'automatic' records an auto-publish event, so
        -- "nobody decided this" stays distinguishable from "the host decided this".
        review_kind          TEXT    CHECK (review_kind IN ('host', 'automatic')),
        reviewed_at          TEXT,
        reviewed_by_user_id  TEXT    REFERENCES users (id) ON DELETE SET NULL,

        CONSTRAINT photos_one_author CHECK (
          (author_guest_id IS NOT NULL AND author_user_id IS NULL) OR
          (author_guest_id IS NULL AND author_user_id IS NOT NULL)
        ),
        CONSTRAINT photos_review_complete CHECK (
          (review_kind IS NULL AND reviewed_at IS NULL) OR
          (review_kind IS NOT NULL AND reviewed_at IS NOT NULL)
        ),
        CONSTRAINT photos_host_review_has_user CHECK (
          review_kind IS NOT 'host' OR reviewed_by_user_id IS NOT NULL
        )
      );

      -- Makes a double-tapped submit, or a retry after a dropped upload, a no-op
      -- instead of the same photo twice on the wall. Scoped per event: two events each
      -- own their copy of the same bytes.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_photos_event_hash
        ON photos (event_id, content_hash);

      -- The moderation queue and the wall playlist. id trails created_at so the sort
      -- is total and two moderators' screens agree.
      CREATE INDEX IF NOT EXISTS idx_photos_event_status_created
        ON photos (event_id, status, created_at DESC, id);

      -- A guest's own photos, and the per-guest upload limit.
      CREATE INDEX IF NOT EXISTS idx_photos_event_author
        ON photos (event_id, author_guest_id);

      -- -------------------------------------------------------------- reactions --
      CREATE TABLE IF NOT EXISTS reactions (
        id          TEXT PRIMARY KEY,
        event_id    TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
        photo_id    TEXT NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
        guest_id    TEXT NOT NULL REFERENCES guests (id) ON DELETE CASCADE,
        kind        TEXT NOT NULL CHECK (kind IN ('love', 'laugh', 'wow', 'cheers', 'clap')),
        created_at  TEXT NOT NULL
      );

      -- One reaction of each kind per guest per photo. The database enforces it so a
      -- double tap on a phone with a flaky connection cannot inflate a count.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_unique
        ON reactions (photo_id, guest_id, kind);
      CREATE INDEX IF NOT EXISTS idx_reactions_event_photo
        ON reactions (event_id, photo_id);
      -- The anti-spam window query.
      CREATE INDEX IF NOT EXISTS idx_reactions_guest_recent
        ON reactions (event_id, guest_id, created_at DESC);

      -- --------------------------------------------------------------- sessions --
      -- Host and moderator sessions. 1.0 used express-session's MemoryStore, which
      -- leaks and drops every session on restart — so a host who restarted the server
      -- mid-event was logged out with a room full of guests uploading.
      CREATE TABLE IF NOT EXISTS sessions (
        sid         TEXT    PRIMARY KEY,
        -- Epoch milliseconds, not ISO text: the sweeper deletes by numeric comparison
        -- on a hot path, and this column is never read by a human.
        expires_at  INTEGER NOT NULL,
        data        TEXT    NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
    `)
  },
}
