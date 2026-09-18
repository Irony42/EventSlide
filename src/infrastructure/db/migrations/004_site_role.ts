import type { Migration } from '../migrator'

/**
 * A site-level role, distinct from an event role (docs/ROADMAP.md §10.1).
 *
 * One column on `users`, not a table. A site role is single-valued per account — there
 * is one box — where an event role is one row per account **per event**, which is why
 * `event_memberships` is a table and this is not. A `site_roles(user_id, role)` table
 * would be a 1:0..1 join carrying nothing the account does not already carry, and every
 * authorization read would pay for it. Clients get their own table when §10.2 lands;
 * being *not* an operator is not a client record.
 *
 * `TEXT` with a `CHECK`, like `events.status` and `event_memberships.role`: the closed
 * set is documented in the column and refused by the database, not only by the domain.
 * Adding a `CHECK` through `ALTER TABLE … ADD COLUMN` is legal in SQLite and applies to
 * every write from here on; the existing rows it does not re-validate all take the
 * default, which satisfies it by construction.
 *
 * No index. The only query is `WHERE id = ?`, which the primary key already serves; the
 * console's "list the operators" of §10.4 reads a table of at most a handful of accounts.
 *
 * ## The backfill, and why it is safe
 *
 * The bootstrap account becomes the operator. It cannot be named here — the migration has
 * no access to `BOOTSTRAP_OWNER_EMAIL`, and on a box where that variable has since
 * changed it would name the wrong row — so it is identified by what it is: the first
 * account ever created. `bootstrapOwner` only ever runs against an empty `users` table,
 * so the oldest row *is* the account the box created for whoever installed it.
 *
 * `disabled_at IS NULL`, because promoting a switched-off account would leave the box
 * with an operator nobody can sign in as and, until §10.4 ships a way to grant the role,
 * no way to appoint another. The tie-break on `id` is for determinism only: two accounts
 * can share a `created_at` in a seeded or restored database, and a migration that picks a
 * different row on two machines is a migration that has to be reasoned about twice.
 *
 * An empty `users` table promotes nobody and needs to: the next boot's `bootstrapOwner`
 * creates the operator itself. A box where every account is disabled promotes nobody
 * either, which is the same box it was before this migration.
 *
 * **Nothing observable changes for an install that wanted none of this.** A site role
 * grants no authority inside any event — no route consults it except an operator's own,
 * of which there are none yet — so the account this promotes can do exactly what it could
 * do yesterday, and so can every other account on the box.
 */
export const migration004: Migration = {
  id: 4,
  name: 'site_role',
  sql: `
      ALTER TABLE users ADD COLUMN site_role TEXT NOT NULL DEFAULT 'none'
        CHECK (site_role IN ('none', 'operator'));

      UPDATE users
         SET site_role = 'operator'
       WHERE id = (SELECT id
                     FROM users
                    WHERE disabled_at IS NULL
                    ORDER BY created_at ASC, id ASC
                    LIMIT 1);
    `,
}
