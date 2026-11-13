import { describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqliteTourLedger } from './sqliteTourLedger'
import { AT, atPlus } from '../../application/testing/builders'
import {
  CONTRACT_ACCOUNTS,
  tourLedgerContract,
} from '../../application/testing/contracts/tourLedgerContract'
import { asUserId } from '../../domain/shared/ids'

/** `user_tours` references `users`, so the accounts the contract names must exist. */
const seededDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)

  const insertUser = db.prepare(
    `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'hash:x', ?)`,
  )
  CONTRACT_ACCOUNTS.forEach((id, index) => {
    insertUser.run(id, `compte-${index}@example.test`, AT.toISOString())
  })
  return db
}

tourLedgerContract('sqlite', async () => {
  const db = seededDatabase()
  return {
    ledger: new SqliteTourLedger(db),
    dispose: async () => {
      closeDatabase(db)
    },
  }
})

describe('SqliteTourLedger', () => {
  const USER = asUserId('user-1')

  it('keeps the first instant a tour was seen', async () => {
    const db = seededDatabase()
    const ledger = new SqliteTourLedger(db)

    await ledger.markSeen(USER, 'eventPage', AT)
    await ledger.markSeen(USER, 'eventPage', atPlus(60_000))

    expect(db.prepare(`SELECT seen_at FROM user_tours`).all()).toEqual([
      { seen_at: AT.toISOString() },
    ])
    closeDatabase(db)
  })

  it('shows nothing for a row a newer build wrote with a tour this one does not know', async () => {
    const db = seededDatabase()
    // A newer build widens the `CHECK`; here the table is rebuilt without it to stand in for one.
    db.exec(`DROP TABLE user_tours;
             CREATE TABLE user_tours (user_id TEXT, tour TEXT, seen_at TEXT)`)
    db.prepare(`INSERT INTO user_tours VALUES (?, 'dashboard', ?)`).run(USER, AT.toISOString())

    expect(await new SqliteTourLedger(db).seenBy(USER)).toEqual([])
    closeDatabase(db)
  })
})
