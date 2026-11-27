import { describe, expect, it } from 'vitest'
import { AT } from '../../application/testing/builders'
import {
  eventMailNoticeLedgerContract,
  NOTICE_CONTRACT_EVENTS,
} from '../../application/testing/contracts/eventMailNoticeLedgerContract'
import { asEventId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqliteEventMailNoticeLedger } from './sqliteEventMailNoticeLedger'

/** `event_mail_notices` references `events`, so the events the contract names must exist. */
const seededDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  db.prepare(
    `INSERT INTO users (id, email, password_hash, created_at)
          VALUES ('user-host', 'hote@example.test', 'hash:x', ?)`,
  ).run(AT.toISOString())
  for (const id of NOTICE_CONTRACT_EVENTS) {
    db.prepare(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                           created_at)
            VALUES (?, 'user-host', ?, ?, ?, 'closed', '{}', 1000000000, ?)`,
    ).run(id, id, id, id, AT.toISOString())
  }
  return db
}

eventMailNoticeLedgerContract('sqlite', async () => {
  const db = seededDatabase()
  return {
    ledger: new SqliteEventMailNoticeLedger(db),
    dispose: async () => {
      closeDatabase(db)
    },
  }
})

describe('SqliteEventMailNoticeLedger', () => {
  const EVENT = asEventId('event-1')

  it('keeps the first instant a notice was noted, and one row for it', async () => {
    const db = seededDatabase()
    const ledger = new SqliteEventMailNoticeLedger(db)

    await ledger.note(EVENT, 'rsvpFull', 'full@120', AT)
    await ledger.note(EVENT, 'rsvpFull', 'full@120', new Date(AT.getTime() + 60_000))

    expect(db.prepare(`SELECT event_id, kind, key, sent_at FROM event_mail_notices`).all()).toEqual(
      [{ event_id: 'event-1', kind: 'rsvpFull', key: 'full@120', sent_at: AT.toISOString() }],
    )
    closeDatabase(db)
  })

  it('goes with its event, which is how the purge reaches it', async () => {
    const db = seededDatabase()
    const ledger = new SqliteEventMailNoticeLedger(db)
    await ledger.note(EVENT, 'eventClosed', 'first', AT)

    db.prepare(`DELETE FROM events WHERE id = ?`).run(EVENT)

    expect(db.prepare(`SELECT COUNT(*) AS n FROM event_mail_notices`).get()).toEqual({ n: 0 })
    closeDatabase(db)
  })
})
