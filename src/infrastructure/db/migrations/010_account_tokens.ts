import type { Migration } from '../migrator'

/**
 * Account tokens and the credentials epoch (docs/ROADMAP.md §10.3; free plan G2-08, paid
 * plan P3-09).
 *
 * Two things that belong together because the second one is what makes the first one safe
 * to ship: a password reset that cannot end the sessions of the account it resets is a
 * reset that leaves a stolen cookie working.
 *
 * ## `users.credentials_changed_at` — the epoch
 *
 * The `sessions` table has no `user_id` (migration 001), so "every session of this
 * account" is not a question the store can answer, and adding the column would mean
 * rewriting a table whose rows are rewritten on every request. The epoch answers it from
 * the other side: the account says *when* its credentials last changed, each session says
 * when it was issued, and `enforceSessionAge` refuses the ones issued earlier. Nullable,
 * because an account whose credentials never changed has nothing to revoke — `NULL` reads
 * as "no epoch", never as "the beginning of time".
 *
 * ## `users.email_verified_at`
 *
 * Added here although nothing in this release writes it. Migrations are append-only, and
 * the invitation and e-mail-verification flows that set it arrive in later items; carrying
 * the column now is free and adding it then would be a migration of its own.
 *
 * ## `account_tokens` — one table for every link that proves control of a mailbox
 *
 * An invitation is a password reset for an account that does not exist yet, so the three
 * purposes share a table, a lifetime rule and a consumption statement rather than three
 * near-copies of a security-critical `UPDATE`.
 *
 * - **`token_digest`, never the token.** The model is `share_links`: 256 random bits in
 *   the URL, the SHA-256 in the row. A backup archive, or a restore rehearsed on a laptop,
 *   resets no password. The `CHECK` refuses the likeliest mistake — a caller writing the
 *   token itself, which is base64url and never 64 lower-case hex digits.
 * - **`delivery`** says how the link was meant to reach its owner: `mail` or `link` (shown
 *   on screen to be copied, because there is no relay). It is part of the row because
 *   whether the *inviter* held the link decides what receiving it proves.
 * - **`requires_approval`, `approved_by`, `approved_at`** serve the operator guard rules of a
 *   later item. They are here now because widening a `CHECK`-bearing table later is a
 *   rebuild, and because `consume` already has to read them: a token that needs approval
 *   and has none is not usable, and that has to be true in the statement that spends it.
 * - **`user_id` cascades; the actors do not.** A reset token for an account that no longer
 *   exists opens nothing, so it goes with the account. `created_by` and `approved_by` are
 *   history about someone else: deleting the *inviter* must not delete the invitation, and
 *   must not fail either, so they are `ON DELETE SET NULL`.
 * - **Rows are kept after use** (`consumed_at`, `revoked_at`) and pruned later by
 *   `expires_at`: a spent token is indistinguishable from one that never existed on the
 *   wire, which is the point, but not in the logs an operator reads.
 *
 * `client_id` and `client_role` are not here: they reference `clients`, and the invitation
 * item adds them in a migration of its own, numbered after both.
 */
export const migration010: Migration = {
  id: 10,
  name: 'account_tokens',
  sql: `
      ALTER TABLE users ADD COLUMN credentials_changed_at TEXT;
      ALTER TABLE users ADD COLUMN email_verified_at TEXT;

      CREATE TABLE IF NOT EXISTS account_tokens (
        id                TEXT PRIMARY KEY,
        purpose           TEXT NOT NULL
                          CHECK (purpose IN ('invitation', 'passwordReset', 'emailVerification')),

        -- SHA-256 of the token, lower-case hex.
        token_digest      TEXT NOT NULL
                          CHECK (length(token_digest) = 64
                                 AND token_digest NOT GLOB '*[^0-9a-f]*'),

        -- Normalised like users.email, so a lookup by address is an index seek.
        email             TEXT NOT NULL,
        user_id           TEXT REFERENCES users (id) ON DELETE CASCADE,
        event_id          TEXT REFERENCES events (id) ON DELETE CASCADE,
        event_role        TEXT CHECK (event_role IS NULL OR event_role = 'moderator'),
        delivery          TEXT NOT NULL CHECK (delivery IN ('mail', 'link')),
        requires_approval INTEGER NOT NULL DEFAULT 0 CHECK (requires_approval IN (0, 1)),
        approved_by       TEXT REFERENCES users (id) ON DELETE SET NULL,
        approved_at       TEXT,
        created_by        TEXT REFERENCES users (id) ON DELETE SET NULL,
        created_at        TEXT NOT NULL,
        expires_at        TEXT NOT NULL,
        consumed_at       TEXT,
        revoked_at        TEXT,

        CHECK (expires_at > created_at)
      );

      -- A link carries the token and nothing else, so this is the lookup.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_account_tokens_digest
        ON account_tokens (token_digest);

      -- "This address's outstanding links" and "how many were issued in the last hour":
      -- both start from the address and the purpose.
      CREATE INDEX IF NOT EXISTS idx_account_tokens_email
        ON account_tokens (email, purpose, created_at);

      -- The prune of expired rows scans on this alone.
      CREATE INDEX IF NOT EXISTS idx_account_tokens_expires
        ON account_tokens (expires_at);
  `,
}
