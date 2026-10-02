import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AT, anAuditEntry, atPlus } from '../../application/testing/builders'
import {
  AUDIT_CONTRACT_FIXTURES,
  auditLogContract,
} from '../../application/testing/contracts/auditLogContract'
import { FakeClock } from '../../application/testing/fakeClock'
import { makePruneAuditLog } from '../../application/usecases/audit/pruneAuditLog'
import { asClientId, asUserId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqliteAuditLog } from './sqliteAuditLog'

/**
 * The shared contract, plus what it cannot state: the log refuses to be changed by anything
 * that holds the connection, the gate is shut again after a prune however the prune ended,
 * and a row the application did not write by this version's rules is read faithfully or
 * refused — never guessed at.
 */

const migratedDb = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  return db
}

/** `audit_log.actor_user_id` references `users`. */
const seedUsers = (db: Db): void => {
  const insertUser = db.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, created_at)
     VALUES (?, ?, NULL, 'hash:un-mot-de-passe-solide', ?)`,
  )
  for (const id of AUDIT_CONTRACT_FIXTURES.userIds) {
    insertUser.run(id, `${id}@example.test`, AT.toISOString())
  }
}

const refusalOf = async (action: () => unknown): Promise<string> => {
  try {
    await action()
  } catch (thrown) {
    return thrown instanceof Error ? thrown.message : String(thrown)
  }
  return 'it did not throw'
}

auditLogContract('sqlite', async () => {
  const db = migratedDb()
  seedUsers(db)
  return { log: new SqliteAuditLog(db), dispose: async () => closeDatabase(db) }
})

describe('SqliteAuditLog', () => {
  let db: Db
  let log: SqliteAuditLog

  beforeEach(() => {
    db = migratedDb()
    seedUsers(db)
    log = new SqliteAuditLog(db)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  const gateIsOpen = (): number =>
    (db.prepare(`SELECT open FROM audit_prune_gate WHERE id = 1`).get() as { open: number }).open

  const countRows = (): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM audit_log`).get() as { n: number }).n

  // ------------------------------------------------- append-only, from outside --

  it('refuses an UPDATE of an entry it wrote, from any code holding the connection', async () => {
    await log.record(anAuditEntry())

    expect(
      await refusalOf(() => db.prepare(`UPDATE audit_log SET action = 'client.renamed'`).run()),
    ).toMatch(/append-only/)
    expect((await log.list({ limit: 1 })).items[0]?.action).toBe('client.ceilingsChanged')
  })

  it('refuses a DELETE of an entry it wrote, however old', async () => {
    await log.record(anAuditEntry({ at: new Date('2001-01-01T00:00:00.000Z') }))

    expect(await refusalOf(() => db.prepare(`DELETE FROM audit_log`).run())).toMatch(
      /deleted only by the retention sweep/,
    )
    expect(countRows()).toBe(1)
  })

  it('reads an entry back with no account once the account is deleted, and the deletion itself succeeds', async () => {
    await log.record(
      anAuditEntry({ actor: { kind: 'operator', userId: asUserId('user-operator') } }),
    )

    db.prepare(`DELETE FROM users WHERE id = 'user-operator'`).run()

    expect((await log.list({ limit: 1 })).items[0]?.actor).toEqual({
      kind: 'operator',
      userId: null,
      label: null,
    })
  })

  // ------------------------------------------------------------ the prune gate --

  it('shuts the gate again after a prune, so a raw DELETE is refused once more', async () => {
    await log.record(anAuditEntry({ at: new Date('2001-01-01T00:00:00.000Z') }))
    await log.record(anAuditEntry({ at: atPlus(0) }))
    await log.pruneOlderThan(AT)

    expect(gateIsOpen()).toBe(0)
    expect(await refusalOf(() => db.prepare(`DELETE FROM audit_log`).run())).toMatch(
      /deleted only by the retention sweep/,
    )
    expect(countRows()).toBe(1)
  })

  it('leaves the gate shut when the delete fails part way, and the rows where they were', async () => {
    await log.record(anAuditEntry({ at: new Date('2001-01-01T00:00:00.000Z') }))
    db.exec(
      `CREATE TEMP TRIGGER poison BEFORE DELETE ON audit_log
         BEGIN SELECT RAISE(ABORT, 'poisoned'); END`,
    )

    expect(await refusalOf(() => log.pruneOlderThan(AT))).toMatch(/poisoned/)

    expect(gateIsOpen()).toBe(0)
    expect(countRows()).toBe(1)
  })

  it('has the gate open at the moment a row goes, and shut again by the time the prune returns', async () => {
    await log.record(anAuditEntry({ at: new Date('2001-01-01T00:00:00.000Z') }))
    // A trigger that records the gate's state at the moment each row is deleted.
    db.exec(`CREATE TEMP TABLE seen (open INTEGER)`)
    db.exec(
      `CREATE TEMP TRIGGER watch BEFORE DELETE ON audit_log
         BEGIN INSERT INTO seen SELECT open FROM audit_prune_gate WHERE id = 1; END`,
    )

    await log.pruneOlderThan(AT)

    expect(db.prepare(`SELECT open FROM seen`).all()).toEqual([{ open: 1 }])
    expect(gateIsOpen()).toBe(0)
  })

  it('takes part in a transaction its caller already opened, and keeps the guarantee inside it', async () => {
    await log.record(anAuditEntry({ at: new Date('2001-01-01T00:00:00.000Z') }))

    // The adapter does its work synchronously before it hands back its promise, which is
    // what lets it run inside a `better-sqlite3` transaction that cannot return one.
    let pruned: Promise<number> | undefined
    db.transaction(() => {
      pruned = log.pruneOlderThan(AT)
    })()

    expect(await pruned).toBe(1)
    expect(countRows()).toBe(0)
    expect(gateIsOpen()).toBe(0)
  })

  // ------------------------------------------- the pruning use case, end to end --

  it('is emptied of what has outlived its retention by pruneAuditLog, and by nothing else', async () => {
    const clock = new FakeClock(new Date('2002-01-02T00:00:00.000Z'))
    await log.record(anAuditEntry({ at: new Date('2001-01-01T00:00:00.000Z') }))
    await log.record(anAuditEntry({ at: new Date('2001-09-01T00:00:00.000Z') }))
    const prune = makePruneAuditLog({ audit: log, clock, retentionDays: 365 })

    const report = await prune()

    expect(report.pruned).toBe(1)
    expect((await log.list({ limit: 10 })).items.map((record) => record.at.toISOString())).toEqual([
      '2001-09-01T00:00:00.000Z',
    ])
  })

  it('judges age by the injected clock and not by SQLite’s: a 2001 row survives on a 2001 clock, whatever today is', async () => {
    // `datetime('now')` is in the 2020s; a pruner that used it would delete this row.
    const clock = new FakeClock(new Date('2001-06-01T00:00:00.000Z'))
    await log.record(anAuditEntry({ at: new Date('2001-01-01T00:00:00.000Z') }))

    const report = await makePruneAuditLog({ audit: log, clock, retentionDays: 365 })()

    expect(report.pruned).toBe(0)
    expect(countRows()).toBe(1)
  })

  // ------------------------------------------------------ what it reads back --

  /** A row the way a later version could have written it, past this version's allow-list. */
  const insertRaw = (overrides: Record<string, string | null> = {}): void => {
    db.prepare(
      `INSERT INTO audit_log (at, actor_user_id, actor_kind, actor_label, action, subject_type,
                              subject_id, client_id, details)
            VALUES (@at, @actorUserId, @actorKind, @actorLabel, @action, @subjectType,
                    @subjectId, @clientId, @details)`,
    ).run({
      at: AT.toISOString(),
      actorUserId: null,
      actorKind: 'system',
      actorLabel: 'moderation',
      action: 'photo.hidden',
      subjectType: 'photo',
      subjectId: 'photo-1',
      clientId: null,
      details: '{"reasonCode":3,"nested":{"flag":true}}',
      ...overrides,
    })
  }

  it('reads a row written under another allow-list: an action this version has never heard of, about a photo, belonging to no client', async () => {
    insertRaw()

    const { items } = await log.list({ limit: 1 })

    expect(items[0]).toEqual({
      seq: expect.any(Number),
      at: AT,
      actor: { kind: 'system', userId: null, label: 'moderation' },
      action: 'photo.hidden',
      subject: { type: 'photo', id: 'photo-1' },
      clientId: null,
      details: { reasonCode: 3, nested: { flag: true } },
    })
  })

  it('lists a row with no client in the operator’s view and never in a client’s', async () => {
    insertRaw()
    await log.record(anAuditEntry({ clientId: 'client-1' }))

    expect((await log.list({ limit: 10 })).items).toHaveLength(2)
    expect(
      (await log.list({ clientId: asClientId('client-1'), limit: 10 })).items.map(
        (record) => record.clientId,
      ),
    ).toEqual(['client-1'])
  })

  describe('a hand-edited row', () => {
    // `ignore_check_constraints` is how a file edited outside the application gets past the
    // schema; it is the only way to build the rows below.
    const insertCorrupt = (overrides: Record<string, string | null>): void => {
      db.pragma('ignore_check_constraints = ON')
      insertRaw(overrides)
      db.pragma('ignore_check_constraints = OFF')
    }

    it('is refused for an actor kind the domain does not have, rather than guessed at', async () => {
      insertCorrupt({ actorKind: 'guest' })

      await expect(log.list({ limit: 1 })).rejects.toThrow(/Corrupt audit_log.actor_kind/)
    })

    it('is refused for a subject type the domain does not have', async () => {
      insertCorrupt({ subjectType: 'galaxy' })

      await expect(log.list({ limit: 1 })).rejects.toThrow(/Corrupt audit_log.subject_type/)
    })

    it('is refused for details that are not JSON, without printing them', async () => {
      insertCorrupt({ details: 'camille@example.test' })

      const message = await refusalOf(() => log.list({ limit: 1 }))
      expect(message).toMatch(/Corrupt audit_log.details/)
      expect(message).not.toContain('camille')
    })

    it('is refused for details that are JSON but not an object', async () => {
      insertCorrupt({ details: '[1,2]' })

      await expect(log.list({ limit: 1 })).rejects.toThrow(/Corrupt audit_log.details/)
    })

    it('is refused for a timestamp that is not one', async () => {
      insertCorrupt({ at: 'last Saturday' })

      await expect(log.list({ limit: 1 })).rejects.toThrow(/Corrupt timestamp/)
    })
  })
})
