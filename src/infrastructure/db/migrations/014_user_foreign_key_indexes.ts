import type { Migration } from '../migrator'

/**
 * An index that leads with the column of every foreign key that points at `users`, because the
 * product now deletes accounts (G2-14 part 3).
 *
 * Migration 013 left these out on one ground: no code path deletes an account, so nothing looks
 * their children up. That ground was a sentence until `scripts/userDeletionScope.test.ts` made it a
 * test, and it fails the day an account is deleted, which is this change: the operator deletes one for
 * a person's erasure request (`deleteAccount`) and the retention sweep deletes the accounts of a
 * client whose engagement has ended (`finalizeOffboardedClients`). Deleting a `users` row makes SQLite
 * look its children up by the foreign-key column — to cascade, to null the column out, or to refuse —
 * and without an index that leads with the column it reads the whole child table, once per deleted
 * account, on the one synchronous connection that also serves every event's upload and wall.
 *
 * - **`audit_log (actor_user_id)`**: the biggest of them. It is the column the erasure nulls on every
 *   line the account ever wrote, so it is the lookup that decides the cost of a deletion. The log's
 *   triggers refuse every update except exactly that `SET NULL`, which is why the foreign key is
 *   `ON DELETE SET NULL` and not a delete.
 * - **`photos (author_user_id)` and `photos (reviewed_by_user_id)`**, **`clip_jobs (author_user_id)`**:
 *   what a host's or a moderator's account cascades or nulls through.
 * - **`account_tokens (user_id)`, `(approved_by)` and `(created_by)`**: the invitations and reset
 *   links written to, approved by and written by an account.
 * - **`share_links (created_by)`**: the shared gallery links an account created, which go with it.
 *
 * Seven of the eight columns are nullable and the index is partial, `WHERE column IS NOT NULL`, like
 * `idx_account_tokens_client` (012) and the four of 013: most photographs are written by a guest, most
 * tokens carry one of the three accounts and not the other two, and a null entry is one nobody looks
 * up. SQLite uses a partial index for an equality lookup on the column (`migrator.test.ts` plans the
 * lookup to hold it). `share_links.created_by` is `NOT NULL` and is a plain index.
 *
 * What was already indexed and is not repeated: `events.owner_id`, `event_memberships.user_id`,
 * `client_members.user_id` and `user_totp.user_id` (a primary key).
 *
 * Nothing is backfilled and no row changes: an index is built from the rows already there. Every new
 * index costs one more entry per write to its table; the audit log's is the one to watch, and it is
 * a single b-tree entry on an append.
 */
export const migration014: Migration = {
  id: 14,
  name: 'user_foreign_key_indexes',
  sql: `
      CREATE INDEX IF NOT EXISTS idx_audit_actor_user
        ON audit_log (actor_user_id)
        WHERE actor_user_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_photos_author_user
        ON photos (author_user_id)
        WHERE author_user_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_photos_reviewed_by
        ON photos (reviewed_by_user_id)
        WHERE reviewed_by_user_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_clip_jobs_author_user
        ON clip_jobs (author_user_id)
        WHERE author_user_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_account_tokens_user
        ON account_tokens (user_id)
        WHERE user_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_account_tokens_approved_by
        ON account_tokens (approved_by)
        WHERE approved_by IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_account_tokens_created_by
        ON account_tokens (created_by)
        WHERE created_by IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_share_links_created_by
        ON share_links (created_by);
    `,
}
