import { describe, expect, it } from 'vitest'
import { AT } from '../../application/testing/builders'
import {
  MAIL_PREFERENCE_CONTRACT_FIXTURES,
  mailPreferenceRepositoryContract,
} from '../../application/testing/contracts/mailPreferenceRepositoryContract'
import { asEventId, asUserId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqliteMailPreferenceRepository } from './sqliteMailPreferenceRepository'

/** The accounts, the events and the memberships the contract names must exist: they are foreign keys. */
const seededDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  const { eventId, otherEventId, userIds } = MAIL_PREFERENCE_CONTRACT_FIXTURES
  for (const id of userIds) {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'hash:x', ?)`,
    ).run(id, `${id}@example.test`, AT.toISOString())
  }
  for (const id of [eventId, otherEventId]) {
    db.prepare(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes, created_at)
            VALUES (?, ?, ?, ?, ?, 'live', '{}', 1000000000, ?)`,
    ).run(id, userIds[0], id, id, id.slice(-1).repeat(6), AT.toISOString())
    for (const userId of userIds) {
      db.prepare(
        `INSERT INTO event_memberships (event_id, user_id, role, granted_at) VALUES (?, ?, 'owner', ?)`,
      ).run(id, userId, AT.toISOString())
    }
  }
  return db
}

mailPreferenceRepositoryContract('sqlite', async () => {
  const db = seededDatabase()
  return {
    repo: new SqliteMailPreferenceRepository(db),
    dispose: async () => {
      closeDatabase(db)
    },
  }
})

describe('SqliteMailPreferenceRepository', () => {
  const A = asUserId('user-a')

  it('writes its own columns and leaves the rest of the account as it was', async () => {
    const db = seededDatabase()
    const repo = new SqliteMailPreferenceRepository(db)
    const before = db
      .prepare(`SELECT email, password_hash, disabled_at FROM users WHERE id = ?`)
      .get(A)

    await repo.save(A, { rsvp: false, event: false })

    expect(
      db.prepare(`SELECT email, password_hash, disabled_at FROM users WHERE id = ?`).get(A),
    ).toEqual(before)
    expect(db.prepare(`SELECT mail_rsvp, mail_event FROM users WHERE id = ?`).get(A)).toEqual({
      mail_rsvp: 0,
      mail_event: 0,
    })
    closeDatabase(db)
  })

  it('stores the claim as ISO text, the form every date of the schema has', async () => {
    const db = seededDatabase()
    const repo = new SqliteMailPreferenceRepository(db)

    await repo.claimDigest(asEventId(MAIL_PREFERENCE_CONTRACT_FIXTURES.eventId), A, null, AT)

    expect(
      db.prepare(`SELECT rsvp_digest_at FROM event_memberships WHERE user_id = ? LIMIT 1`).get(A),
    ).toEqual({ rsvp_digest_at: AT.toISOString() })
    closeDatabase(db)
  })
})
