import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AT, anEventSettings } from '../../application/testing/builders'
import {
  MEMBERSHIP_CONTRACT_FIXTURES,
  membershipRepositoryContract,
} from '../../application/testing/contracts/membershipRepositoryContract'
import { asEventId, asUserId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqliteMembershipRepository } from './sqliteMembershipRepository'

/**
 * The shared contract, plus the two things it cannot state: the identity columns come
 * from a join over `users`, and both foreign keys are enforced — a membership pointing
 * at an event or an account that does not exist is an authorization hole, not a row.
 */

const WEDDING = asEventId('evt-wedding')
const HOST = asUserId('user-host')
const MOD = asUserId('user-mod')

const migratedDb = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  return db
}

/** `AAAAAA`, `BBBBBB`, … — `events.join_code` is unique across every event. */
const joinCodeFor = (index: number): string => String.fromCodePoint(65 + index).repeat(6)

/**
 * `event_memberships` references both tables, so the contract's events and users must
 * exist before a single grant. The event rows are complete even though this repository
 * never reads them: a half-filled fixture would only fail later, on someone else's test.
 */
const seedFixtures = (db: Db): void => {
  const insertUser = db.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
  for (const id of MEMBERSHIP_CONTRACT_FIXTURES.userIds) {
    insertUser.run(id, `${id}@example.test`, null, 'hash:un-mot-de-passe-solide', AT.toISOString())
  }

  const insertEvent = db.prepare(
    `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings,
                         quota_bytes, created_at)
     VALUES (?, ?, 'Camille & Sacha', ?, ?, 'live', ?, 1000000000, ?)`,
  )
  MEMBERSHIP_CONTRACT_FIXTURES.eventIds.forEach((id, index) => {
    insertEvent.run(
      id,
      HOST,
      id,
      joinCodeFor(index),
      JSON.stringify(anEventSettings().toProps()),
      AT.toISOString(),
    )
  })
}

/** better-sqlite3 exposes a stable `code`; the message is not part of the contract. */
const sqliteCodeOf = (thrown: unknown): string =>
  thrown instanceof Error && 'code' in thrown && typeof thrown.code === 'string'
    ? thrown.code
    : `not a SqliteError: ${String(thrown)}`

const rejectionOf = async (action: () => Promise<unknown>): Promise<unknown> => {
  try {
    await action()
  } catch (thrown) {
    return thrown
  }
  return new Error('the action resolved instead of rejecting')
}

membershipRepositoryContract('sqlite', async () => {
  const db = migratedDb()
  seedFixtures(db)

  return {
    repo: new SqliteMembershipRepository(db),
    dispose: async () => closeDatabase(db),
  }
})

describe('SqliteMembershipRepository', () => {
  let db: Db
  let repo: SqliteMembershipRepository

  beforeEach(() => {
    db = migratedDb()
    seedFixtures(db)
    repo = new SqliteMembershipRepository(db)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  // ------------------------------------------------------------------- join --

  it('carries the email of each listed member, so the host list names real accounts', async () => {
    await repo.grant({ eventId: WEDDING, userId: MOD, role: 'moderator', grantedAt: AT })

    const members = await repo.listForEvent(WEDDING)

    expect(members.map((member) => member.email)).toEqual(['user-mod@example.test'])
  })

  it('reports a member who never set a display name as null, not as an empty name', async () => {
    await repo.grant({ eventId: WEDDING, userId: MOD, role: 'moderator', grantedAt: AT })

    const members = await repo.listForEvent(WEDDING)

    expect(members.map((member) => member.displayName)).toEqual([null])
  })

  it('carries the display name a member has set', async () => {
    db.prepare(`UPDATE users SET display_name = ? WHERE id = ?`).run('Léa', MOD)
    await repo.grant({ eventId: WEDDING, userId: MOD, role: 'moderator', grantedAt: AT })

    const members = await repo.listForEvent(WEDDING)

    expect(members.map((member) => member.displayName)).toEqual(['Léa'])
  })

  // ----------------------------------------------------------- foreign keys --

  it.each([
    { dangling: 'event', eventId: asEventId('evt-ghost'), userId: MOD },
    { dangling: 'user', eventId: WEDDING, userId: asUserId('user-ghost') },
  ])('refuses a membership whose $dangling does not exist', async ({ eventId, userId }) => {
    const thrown = await rejectionOf(() =>
      repo.grant({ eventId, userId, role: 'moderator', grantedAt: AT }),
    )

    expect(sqliteCodeOf(thrown)).toBe('SQLITE_CONSTRAINT_FOREIGNKEY')
  })

  // ------------------------------------------------------------ corrupt rows --

  it('refuses to hydrate a role outside the two the product defines', async () => {
    await repo.grant({ eventId: WEDDING, userId: MOD, role: 'moderator', grantedAt: AT })
    // The column carries a CHECK, so only a hand-edited database reaches this state —
    // which is what the pragma reproduces. Guessing a role here would either lock a
    // host out of their own event or silently promote a moderator.
    db.pragma('ignore_check_constraints = ON')
    db.prepare(`UPDATE event_memberships SET role = 'admin' WHERE user_id = ?`).run(MOD)

    await expect(repo.roleFor(WEDDING, MOD)).rejects.toThrow()
  })
})
