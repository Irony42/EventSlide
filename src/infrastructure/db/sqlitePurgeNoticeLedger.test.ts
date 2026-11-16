import { describe, expect, it } from 'vitest'
import { AT, atPlus } from '../../application/testing/builders'
import {
  CONTRACT_EVENTS,
  purgeNoticeLedgerContract,
} from '../../application/testing/contracts/purgeNoticeLedgerContract'
import { asEventId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqlitePurgeNoticeLedger } from './sqlitePurgeNoticeLedger'

/** `event_purge_notices` references `events`, so the events the contract names must exist. */
const seededDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  db.prepare(
    `INSERT INTO users (id, email, password_hash, created_at)
          VALUES ('user-host', 'hote@example.test', 'hash:x', ?)`,
  ).run(AT.toISOString())
  for (const id of CONTRACT_EVENTS) {
    db.prepare(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                           created_at)
            VALUES (?, 'user-host', ?, ?, ?, 'closed', '{}', 1000000000, ?)`,
    ).run(id, id, id, id, AT.toISOString())
  }
  return db
}

purgeNoticeLedgerContract('sqlite', async () => {
  const db = seededDatabase()
  return {
    ledger: new SqlitePurgeNoticeLedger(db),
    dispose: async () => {
      closeDatabase(db)
    },
  }
})

describe('SqlitePurgeNoticeLedger', () => {
  const EVENT = asEventId('event-1')

  it('keeps one row per event and the instant of the latest note', async () => {
    const db = seededDatabase()
    const ledger = new SqlitePurgeNoticeLedger(db)

    await ledger.note(EVENT, 14, AT)
    await ledger.note(EVENT, 3, atPlus(60_000))

    expect(db.prepare(`SELECT event_id, level, sent_at FROM event_purge_notices`).all()).toEqual([
      { event_id: 'event-1', level: 3, sent_at: atPlus(60_000).toISOString() },
    ])
    closeDatabase(db)
  })

  it('goes with its event, which is how the purge reaches it', async () => {
    const db = seededDatabase()
    const ledger = new SqlitePurgeNoticeLedger(db)
    await ledger.note(EVENT, 1, AT)

    db.prepare(`DELETE FROM events WHERE id = ?`).run(EVENT)

    expect(db.prepare(`SELECT COUNT(*) AS n FROM event_purge_notices`).get()).toEqual({ n: 0 })
    closeDatabase(db)
  })

  it('refuses a level outside the three thresholds, whatever wrote it', () => {
    const db = seededDatabase()
    expect(() =>
      db
        .prepare(`INSERT INTO event_purge_notices (event_id, level, sent_at) VALUES (?, 7, ?)`)
        .run(EVENT, AT.toISOString()),
    ).toThrow(/CHECK/)
    closeDatabase(db)
  })

  it('shows nothing noted for a row a newer build wrote with a threshold this one does not know', async () => {
    const db = seededDatabase()
    // A newer build widens the `CHECK`; the table is rebuilt without it to stand in for one.
    db.exec(`DROP TABLE event_purge_notices;
             CREATE TABLE event_purge_notices (event_id TEXT PRIMARY KEY, level INTEGER, sent_at TEXT)`)
    db.prepare(`INSERT INTO event_purge_notices VALUES (?, 7, ?)`).run(EVENT, AT.toISOString())

    expect(await new SqlitePurgeNoticeLedger(db).lastLevel(EVENT)).toBeNull()
    closeDatabase(db)
  })
})
