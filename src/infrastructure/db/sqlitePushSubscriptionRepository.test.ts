import { describe, expect, it } from 'vitest'
import {
  PUSH_CONTRACT_FIXTURES,
  pushSubscriptionRepositoryContract,
} from '../../application/testing/contracts/pushSubscriptionRepositoryContract'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrate } from './migrator'
import { migrations } from './migrations'
import { SqlitePushSubscriptionRepository } from './sqlitePushSubscriptionRepository'

const AT = '2026-11-23T10:00:00.000Z'

/** The parents the contract's rows point at; `PRAGMA foreign_keys` is ON for every connection. */
const migratedDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  for (const id of PUSH_CONTRACT_FIXTURES.userIds) {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at)
            VALUES (?, ? || '@example.test', 'hash:x', ?)`,
    ).run(id, id, AT)
  }
  for (const id of PUSH_CONTRACT_FIXTURES.eventIds) {
    db.prepare(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                           created_at)
            VALUES (?, 'user-one', ?, ?, ?, 'live', '{}', 1000000000, ?)`,
    ).run(id, id, id, id, AT)
  }
  return db
}

pushSubscriptionRepositoryContract('sqlite', async () => {
  const db = migratedDatabase()
  return { repo: new SqlitePushSubscriptionRepository(db), dispose: async () => closeDatabase(db) }
})

describe('SqlitePushSubscriptionRepository storage', () => {
  it('goes with its event: deleting the event deletes its subscriptions', async () => {
    const db = migratedDatabase()
    db.prepare(
      `INSERT INTO push_subscriptions (id, user_id, event_id, endpoint, p256dh, auth, created_at)
       VALUES ('s-1', 'user-one', 'evt-wedding', 'https://a.example/x', 'k', 'a', ?)`,
    ).run(AT)

    db.prepare(`DELETE FROM events WHERE id = 'evt-wedding'`).run()

    expect(db.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions`).get()).toEqual({ n: 0 })
    closeDatabase(db)
  })
})
