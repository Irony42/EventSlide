import type { Migration } from '../migrator'

/**
 * Self-service signup requests (spec 31, ADR 0018).
 *
 * A request is **not an account**: this table holds what a stranger typed into the public form and
 * where the request stands (`unconfirmed`, `pending`, `approving`, `approved`, `refused`, `expired`;
 * `domain/signups/signupRequest.ts`). No `users` row, no `clients` row and no password come from it:
 * the account is born by the existing invitation.
 *
 * - **Dates are ISO text**, like `account_tokens` (`toIsoText` / `fromIsoText`), so the sweep's string
 *   comparisons are honest.
 * - **`account_tokens` is not altered.** The confirmation link is an `account_tokens` row of purpose
 *   `emailVerification` with no `user_id` (the column is nullable and `issueAccountToken` allows it);
 *   the request is found from the token's address and its `unconfirmed` status. Nothing here references
 *   the token of the confirmation, so there is no circular key.
 * - **At most one `unconfirmed` request per address**, by a partial unique index: the admission rule
 *   relies on it, and a race between two submissions cannot leave two.
 * - **Every foreign key `SET NULL`s**: erasing an account, a client or an invitation never breaks a
 *   request that is still within its (at most 60 days) retention, and each key has its \`idx_\` index.
 */
export const migration041: Migration = {
  id: 41,
  name: 'signup_requests',
  sql: `
      CREATE TABLE IF NOT EXISTS signup_requests (
        id                  TEXT PRIMARY KEY,
        -- Normalised like users.email (the EmailAddress form).
        email               TEXT NOT NULL,
        client_name         TEXT NOT NULL CHECK (length(client_name) BETWEEN 1 AND 200),
        note                TEXT,
        -- YYYY-MM-DD
        event_date          TEXT,
        locale              TEXT NOT NULL CHECK (locale IN ('fr', 'en', 'de', 'es', 'it')),
        status              TEXT NOT NULL
                            CHECK (status IN ('unconfirmed', 'pending', 'approving',
                                              'approved', 'refused', 'expired')),
        created_at          TEXT NOT NULL,
        confirmed_at        TEXT,
        decided_at          TEXT,
        decided_by          TEXT REFERENCES users (id) ON DELETE SET NULL,
        client_id           TEXT REFERENCES clients (id) ON DELETE SET NULL,
        invitation_token_id TEXT REFERENCES account_tokens (id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_signup_requests_email
        ON signup_requests (email, created_at);
      CREATE INDEX IF NOT EXISTS idx_signup_requests_status
        ON signup_requests (status, created_at);
      CREATE INDEX IF NOT EXISTS idx_signup_requests_decided_by
        ON signup_requests (decided_by);
      CREATE INDEX IF NOT EXISTS idx_signup_requests_client_id
        ON signup_requests (client_id);
      CREATE INDEX IF NOT EXISTS idx_signup_requests_invitation_token_id
        ON signup_requests (invitation_token_id);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_signup_requests_one_unconfirmed
        ON signup_requests (email)
        WHERE status = 'unconfirmed';
  `,
}
