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
 * That identity is the whole warrant for the backfill, so the statement is written to
 * keep it. The subquery picks the first account with **no filter on it at all**, and
 * `disabled_at IS NULL` sits on the `UPDATE` instead: the migration promotes the account
 * the box was installed with, or it promotes nobody. It never walks to the next row.
 *
 * Reading it the other way round — "the oldest account that is not disabled" — looks like
 * the same rule and is not. It answers a different question the moment the installer's
 * row is switched off, and the answer on any box that has run for a year is the first
 * account somebody was *invited* into: a bride who moderated one evening. `registerModerator`
 * writes `siteRole: 'none'` explicitly, with the comment "an invitation that carried that
 * across would hand the box to a moderator"; walking past a disabled row would do exactly
 * that from the other end, silently, at upgrade time.
 *
 * The asymmetry is what decides it. A box with **no** operator loses nothing at 10.1:
 * `requireOperator` is mounted on no production route, the role is inert, and §10.4 — the
 * first item that needs an operator — is also the item that ships a way to appoint one.
 * A box with the **wrong** operator holds a site-level grant that no route can revoke,
 * made invisibly, that §10.2–10.6 then build on.
 *
 * The tie-break on `id` is for determinism only: two accounts can share a `created_at` in
 * a seeded or restored database, and a migration that picks a different row on two
 * machines is a migration that has to be reasoned about twice.
 *
 * An empty `users` table promotes nobody and needs to: the next boot's `bootstrapOwner`
 * creates the operator itself. A box where every account is disabled promotes nobody
 * either, which is the same box it was before this migration. Both have their own tests.
 *
 * What this cannot see is a first account that was **deleted** rather than switched off:
 * a deleted row and a row that never existed are the same absence, so the oldest survivor
 * is then promoted. `events.owner_id` is `ON DELETE RESTRICT`, which makes deleting the
 * account that owns the box's events hard rather than impossible, and no cheaper signal
 * exists in the schema. It is recorded here rather than left for somebody to discover.
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
                    ORDER BY created_at ASC, id ASC
                    LIMIT 1)
         AND disabled_at IS NULL;
    `,
}
