import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqliteUserRepository } from './sqliteUserRepository'
import { AT, aUser } from '../../application/testing/builders'
import { userRepositoryContract } from '../../application/testing/contracts/userRepositoryContract'
import { asUserId } from '../../domain/shared/ids'
import { EmailAddress } from '../../domain/users/emailAddress'

const HOST = asUserId('user-host')

/** `users` has no outbound foreign key, so the contract needs nothing seeded. */
const migratedDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  return db
}

const email = (value: string): EmailAddress => {
  const parsed = EmailAddress.create(value)
  if (!parsed.ok) throw new Error(`invalid fixture email: ${value}`)
  return parsed.value
}

interface EmailRow {
  readonly email: string
}

interface FlagRow {
  readonly must_change_password: number
}

interface SiteRoleRow {
  readonly site_role: string
}

interface CountRow {
  readonly total: number
}

/** A wedding owned by `user-host`, to prove a re-save does not cascade the role away. */
const grantOwnership = (db: Db): void => {
  db.prepare<[string]>(
    `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                         created_at)
          VALUES ('evt-wedding', 'user-host', 'Camille & Sacha', 'camille-et-sacha', 'H7K2QM',
                  'live', '{}', 1000000000, ?)`,
  ).run(AT.toISOString())

  db.prepare<[string]>(
    `INSERT INTO event_memberships (event_id, user_id, role, granted_at)
          VALUES ('evt-wedding', 'user-host', 'owner', ?)`,
  ).run(AT.toISOString())
}

const roleCount = (db: Db): number => {
  const row = db
    .prepare<[string], CountRow>(
      `SELECT COUNT(*) AS total FROM event_memberships WHERE user_id = ?`,
    )
    .get(HOST)

  return row?.total ?? 0
}

const passwordFlags: readonly [boolean, number][] = [
  [true, 1],
  [false, 0],
]

userRepositoryContract('sqlite', async () => {
  const db = migratedDatabase()

  return {
    repo: new SqliteUserRepository(db),
    dispose: async () => {
      closeDatabase(db)
    },
  }
})

describe('SqliteUserRepository', () => {
  let db: Db
  let repo: SqliteUserRepository

  beforeEach(() => {
    db = migratedDatabase()
    repo = new SqliteUserRepository(db)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  // -------------------------------------------------------- the unique index --

  it('lets the unique email index refuse a second account with the same address', async () => {
    // Asserted on the SQLite constraint code: the index is the enforcement, so two
    // hosts signing up at the same moment cannot both take the address.
    await repo.save(aUser({ id: 'user-host', email: 'hote@example.test' }))

    const second = repo.save(aUser({ id: 'user-mod', email: 'hote@example.test' }))

    await expect(second).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_UNIQUE' })
  })

  it('leaves the account holding an address in place when a duplicate is refused', async () => {
    // `INSERT OR REPLACE` would resolve the conflict by deleting the first account and
    // taking its address — handing one host's identity to another.
    await repo.save(aUser({ id: 'user-host', email: 'hote@example.test' }))
    await expect(repo.save(aUser({ id: 'user-mod', email: 'hote@example.test' }))).rejects.toThrow()

    const stored = await repo.findByEmail(email('hote@example.test'))

    expect(stored?.id).toBe('user-host')
  })

  it('keeps the event roles of an account that is saved again', async () => {
    // The same REPLACE trap from the other side: a host saving their display name must
    // not cascade `event_memberships` away and lock themselves out of their own event.
    const user = aUser({ id: 'user-host' })
    await repo.save(user)
    grantOwnership(db)

    await repo.save(user.rename('Camille'))

    expect(roleCount(db)).toBe(1)
  })

  // ------------------------------------------------------------ stored shape --

  it('stores the address already lowercased, so the unique index is usable directly', async () => {
    await repo.save(aUser({ id: 'user-host', email: 'HOTE@Example.TEST' }))

    const row = db.prepare<[string], EmailRow>(`SELECT email FROM users WHERE id = ?`).get(HOST)

    expect(row?.email).toBe('hote@example.test')
  })

  it.each(passwordFlags)(
    'stores a forced password change of %s as the integer %i',
    async (flag, stored) => {
      await repo.save(aUser({ id: 'user-host', mustChangePassword: flag }))

      const row = db
        .prepare<[string], FlagRow>(`SELECT must_change_password FROM users WHERE id = ?`)
        .get(HOST)

      expect(row?.must_change_password).toBe(stored)
    },
  )

  it('stores the site role in its own column, where the CHECK constraint can refuse it', async () => {
    await repo.save(aUser({ id: 'user-host', siteRole: 'operator' }))

    const row = db
      .prepare<[string], SiteRoleRow>(`SELECT site_role FROM users WHERE id = ?`)
      .get(HOST)

    expect(row?.site_role).toBe('operator')
  })

  it('refuses to hydrate an account whose stored site role the domain rejects', async () => {
    // The CHECK refuses one on the way in, so this row can only exist if somebody wrote
    // around the application — and reading an unrecognised value as an operator, or
    // quietly as nothing, are both worse answers than failing.
    db.prepare<[string]>(
      `INSERT INTO users (id, email, password_hash, created_at, site_role)
            VALUES ('user-odd', 'odd@example.test', 'hash:seed', ?, 'none')`,
    ).run(AT.toISOString())
    db.prepare(`PRAGMA ignore_check_constraints = ON`).run()
    db.prepare(`UPDATE users SET site_role = 'root' WHERE id = 'user-odd'`).run()
    db.prepare(`PRAGMA ignore_check_constraints = OFF`).run()

    await expect(repo.findById(asUserId('user-odd'))).rejects.toThrow(/site_role/)
  })

  it('answers the authorization read without hydrating the account', async () => {
    // A different statement from `findById`, so it gets its own case at this ring as well
    // as in the contract: a bcrypt hash has no business on the heap of a request that
    // only asked whether the caller runs the box.
    await repo.save(aUser({ id: 'user-host', siteRole: 'operator' }))

    expect(await repo.siteRoleFor(HOST)).toBe('operator')
  })

  it('refuses the authorization read on the same corrupt row it refuses to hydrate', async () => {
    // The case above and `refuses to hydrate…` are two different statements over one
    // column, and only the hydrating one was asserted — so `siteRoleFor`, which is the
    // read `requireOperator` actually makes, could be changed to treat an unrecognised
    // value as `operator` with nothing in the repository failing.
    //
    // One row, one meaning. `findById` already throws on this row, so an answer here of
    // `none` would make the same stored value mean two different things depending on
    // which statement read it — and a site role nobody can state is a fact about the
    // database, not a login to serve quietly. The port contract cannot reach this:
    // `FakeUserRepository` holds `User` objects, where an unrecognised value is
    // unrepresentable, so ring 3 is the only place the rule can be held at all.
    db.prepare<[string]>(
      `INSERT INTO users (id, email, password_hash, created_at, site_role)
            VALUES ('user-odd', 'odd@example.test', 'hash:seed', ?, 'none')`,
    ).run(AT.toISOString())
    db.prepare(`PRAGMA ignore_check_constraints = ON`).run()
    db.prepare(`UPDATE users SET site_role = 'root' WHERE id = 'user-odd'`).run()
    db.prepare(`PRAGMA ignore_check_constraints = OFF`).run()

    await expect(repo.siteRoleFor(asUserId('user-odd'))).rejects.toThrow(/site_role/)
  })

  // ------------------------------------------------------------------ deletion --

  it('refuses to delete a host who still owns an event, so no album leaves with them', async () => {
    // `events.owner_id` is ON DELETE RESTRICT, which only bites while the foreign-key
    // pragma is on. Ownership is transferred first, deliberately. SQLite implements
    // RESTRICT as an immediate action, so the code is `_TRIGGER` rather than the
    // `_FOREIGNKEY` a deferred violation reports.
    await repo.save(aUser({ id: 'user-host' }))
    grantOwnership(db)

    await expect(repo.delete(HOST)).rejects.toMatchObject({
      code: 'SQLITE_CONSTRAINT_TRIGGER',
    })
  })

  it('refuses to hydrate an account whose stored address the domain rejects', async () => {
    // A corrupt row is a bug to surface, not a login to serve: the unique index assumes
    // a normalised address, and an account whose identifier is not one breaks that.
    db.prepare<[string]>(
      `INSERT INTO users (id, email, password_hash, created_at)
            VALUES ('user-corrupt', 'pas-une-adresse', 'hash:seed', ?)`,
    ).run(AT.toISOString())

    await expect(repo.findById(asUserId('user-corrupt'))).rejects.toThrow()
  })
})
