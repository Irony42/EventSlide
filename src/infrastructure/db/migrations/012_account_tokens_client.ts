import type { Migration } from '../migrator'

/**
 * The client an invitation is for (docs/ROADMAP.md §10.3; free plan G2-09, paid plan
 * P3-10).
 *
 * An invitation grants one thing: a role inside one event (`event_id` + `event_role`, which
 * migration 010 already carries) or a place in one client's account (`client_id` +
 * `client_role`, added here). The two columns were left out of 010 because they reference
 * `clients`, which migration 008 creates: a migration may only reference a table a lower
 * number made, and the id of this one is that rule applied.
 *
 * - **`client_role` is `owner` or `member`**, the two values of `client_members.role`
 *   (`domain/clients/clientRole.ts`). It is never ranked against the event role beside it:
 *   they are different vocabularies in different columns, and an invitation names exactly
 *   one of the two pairs.
 * - **A role without a client, or a client without a role, is refused by the table.** Each
 *   half of the pair is meaningless alone — a client the accepted account joins as nothing,
 *   a role in nobody's account — and the domain's `issueAccountToken` refuses the same
 *   shapes, so the database is the second line and not the only one.
 * - **`ON DELETE CASCADE`**, like `user_id` and `event_id` in 010: an invitation to a
 *   client that no longer exists opens nothing, so it goes with it. This is also what lets
 *   `deleteEmptyClient` ignore invitations altogether.
 * - **No backfill.** Every existing row is a password-reset token or an invitation to an
 *   event, and both columns are `NULL` for them.
 *
 * The partial index is for the cascade, not for a query: deleting a client scans
 * `account_tokens` for its invitations, and without an index that scan is the whole table.
 */
export const migration012: Migration = {
  id: 12,
  name: 'account_tokens_client',
  sql: `
      ALTER TABLE account_tokens
        ADD COLUMN client_id TEXT REFERENCES clients (id) ON DELETE CASCADE;

      ALTER TABLE account_tokens
        ADD COLUMN client_role TEXT
        CHECK (client_role IS NULL OR client_role IN ('owner', 'member'))
        CHECK ((client_id IS NULL) = (client_role IS NULL));

      CREATE INDEX IF NOT EXISTS idx_account_tokens_client
        ON account_tokens (client_id)
        WHERE client_id IS NOT NULL;
  `,
}
