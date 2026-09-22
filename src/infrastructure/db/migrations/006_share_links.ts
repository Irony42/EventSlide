import type { Migration } from '../migrator'

/**
 * Shared gallery links (docs/ROADMAP.md §4.1): the link a host sends after the event.
 *
 * ## What is stored, and what deliberately is not
 *
 * **`token_digest`, never the token.** The token is 256 random bits in the URL; the row
 * holds its SHA-256. A copy of this file — a backup archive, a restore rehearsed on a
 * laptop — opens no gallery. A fast hash rather than bcrypt because the secret is random
 * rather than chosen, and because the lookup has to be an index seek: a guest's request
 * names no event, so the digest is the only key it has.
 *
 * **`password_hash`, from the same hasher as an account's**, or `NULL` for a link that
 * opens on the token alone.
 *
 * **`created_by`**: the account whose authority minted the link. It is read on every
 * request, so a switched-off account's links stop working with it — the column is what
 * lets `roleFor` be asked. `ON DELETE CASCADE`, because a link whose creator is gone has
 * nobody's authority behind it at all.
 *
 * ## One current link per event, in the database
 *
 * `idx_share_links_current` is a partial unique index over the unrevoked rows, so the
 * rule holds against two hosts pressing "new link" at once rather than only in code.
 * Expiry is not in the predicate — `now` is not a thing an index can know — so an
 * expired link stays current until it is replaced, which is also what lets the console
 * say "your link expired on the 20th" rather than pretending there never was one.
 *
 * Revoked rows are kept. They cost a few dozen bytes, and deleting them would let a
 * revoked token become indistinguishable from one that never existed in the logs an
 * operator reads — the answer on the wire is the same either way, by design.
 *
 * `ON DELETE CASCADE` from `events`, like every event-scoped table: purging an event,
 * by hand or by retention, takes its links with it, and a token for an album that no
 * longer exists opens nothing.
 */
export const migration006: Migration = {
  id: 6,
  name: 'share_links',
  sql: `
      CREATE TABLE IF NOT EXISTS share_links (
        id            TEXT PRIMARY KEY,
        event_id      TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,

        -- SHA-256 of the token, lower-case hex. The CHECK refuses the likeliest mistake:
        -- a caller writing the token itself, which is base64url and never this shape.
        token_digest  TEXT NOT NULL
                      CHECK (length(token_digest) = 64
                             AND token_digest NOT GLOB '*[^0-9a-f]*'),

        password_hash TEXT,
        created_by    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        created_at    TEXT NOT NULL,
        expires_at    TEXT NOT NULL,
        revoked_at    TEXT,

        CHECK (expires_at > created_at)
      );

      -- A guest's request carries the token and nothing else, so this is the lookup.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_share_links_token
        ON share_links (token_digest);

      -- At most one unrevoked link per event, whatever the application does.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_share_links_current
        ON share_links (event_id)
        WHERE revoked_at IS NULL;

      -- Leading with event_id like every event-scoped table: the cascade and the host's
      -- own read both start from the event.
      CREATE INDEX IF NOT EXISTS idx_share_links_event
        ON share_links (event_id, created_at);
  `,
}
