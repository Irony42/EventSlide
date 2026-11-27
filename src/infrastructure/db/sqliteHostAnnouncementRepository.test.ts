import { describe, expect, it } from 'vitest'
import { CapturingLogger } from '../../application/testing/capturingLogger'
import { FakeClock } from '../../application/testing/fakeClock'
import { FakeMailBudget } from '../../application/testing/fakeMailBudget'
import { FakeMailer } from '../../application/testing/fakeMailer'
import { makeSweepHostAnnouncements } from '../../application/usecases/notices/sweepHostAnnouncements'
import { hostAnnouncementRepositoryContract } from '../../application/testing/contracts/hostAnnouncementRepositoryContract'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqliteHostAnnouncementRepository } from './sqliteHostAnnouncementRepository'

const AT = '2026-11-27T10:00:00.000Z'

const migratedDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  return db
}

/** The accounts and clients the contract names, written as the tables hold them. */
const world = (db: Db) => {
  let clients = 0
  const user = (id: string, email: string): void => {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'hash:x', ?)`,
    ).run(id, email, AT)
  }
  const client = (): string => {
    clients += 1
    const id = `client-${clients}`
    db.prepare(`INSERT INTO clients (id, name, created_at) VALUES (?, ?, ?)`).run(
      id,
      `Client ${clients}`,
      AT,
    )
    return id
  }
  const member = (clientId: string, userId: string, role: 'owner' | 'member'): void => {
    db.prepare(
      `INSERT INTO client_members (client_id, user_id, role, granted_at) VALUES (?, ?, ?, ?)`,
    ).run(clientId, userId, role, AT)
  }
  return { user, client, member }
}

hostAnnouncementRepositoryContract('sqlite', async () => {
  const db = migratedDatabase()
  const rows = world(db)
  return {
    repo: new SqliteHostAnnouncementRepository(db),
    addOwner: async (userId, email) => {
      rows.user(userId, email)
      rows.member(rows.client(), userId, 'owner')
    },
    addMember: async (userId, email) => {
      rows.user(userId, email)
      rows.member(rows.client(), userId, 'member')
    },
    addStranger: async (userId, email) => {
      rows.user(userId, email)
    },
    switchOff: async (userId) => {
      db.prepare(`UPDATE users SET disabled_at = ? WHERE id = ?`).run(AT, userId)
    },
    ownAnotherClient: async (userId) => {
      rows.member(rows.client(), userId, 'owner')
    },
    dispose: async () => {
      closeDatabase(db)
    },
  }
})

describe('SqliteHostAnnouncementRepository', () => {
  it('keeps no address of its own: a recipient is read from the account at each batch', async () => {
    const db = migratedDatabase()
    const rows = world(db)
    rows.user('u-a', 'a@example.test')
    rows.member(rows.client(), 'u-a', 'owner')
    const repo = new SqliteHostAnnouncementRepository(db)
    await repo.create({
      id: 'a-one',
      subject: 's',
      text: 't',
      link: null,
      createdBy: null,
      createdAt: new Date(AT),
      finishedAt: null,
    })
    db.prepare(`UPDATE users SET email = 'moved@example.test' WHERE id = 'u-a'`).run()

    expect(await repo.pendingRecipients('a-one', 5)).toEqual([
      { userId: 'u-a', email: 'moved@example.test' },
    ])
    expect(JSON.stringify(db.prepare(`SELECT * FROM host_announcement_deliveries`).all())).toBe(
      '[]',
    )
    closeDatabase(db)
  })

  it('goes with its author’s deletion as a text that outlives them', async () => {
    const db = migratedDatabase()
    const rows = world(db)
    rows.user('u-a', 'a@example.test')
    const repo = new SqliteHostAnnouncementRepository(db)
    await repo.create({
      id: 'a-one',
      subject: 's',
      text: 't',
      link: null,
      createdBy: 'u-a',
      createdAt: new Date(AT),
      finishedAt: null,
    })

    db.prepare(`DELETE FROM users WHERE id = 'u-a'`).run()

    expect((await repo.listRecent(1))[0]?.announcement.createdBy).toBeNull()
    closeDatabase(db)
  })

  it('lets two sweepers on one database write to every address once, and take nothing from the day twice', async () => {
    const db = migratedDatabase()
    const rows = world(db)
    for (let i = 1; i <= 25; i += 1) {
      rows.user(`u-${String(i).padStart(2, '0')}`, `hote${i}@example.test`)
      rows.member(rows.client(), `u-${String(i).padStart(2, '0')}`, 'owner')
    }
    const repo = new SqliteHostAnnouncementRepository(db)
    await repo.create({
      id: 'a-one',
      subject: 'Sujet',
      text: 'Texte',
      link: null,
      createdBy: null,
      createdAt: new Date(AT),
      finishedAt: null,
    })
    const mailer = new FakeMailer()
    const budget = new FakeMailBudget(null)
    const sweeper = () =>
      makeSweepHostAnnouncements({
        announcements: repo,
        budget,
        mailer,
        clock: new FakeClock(new Date('2026-11-28T03:00:00.000Z')),
        logger: new CapturingLogger(),
        operatorContact: null,
        batchSize: 4,
      })

    const [first, second] = await Promise.all([sweeper()(), sweeper()()])

    expect(first.sent + second.sent).toBe(25)
    expect(new Set(mailer.sent.map((mail) => mail.to)).size).toBe(25)
    expect(mailer.sent).toHaveLength(25)
    expect(await budget.used('2026-11-28')).toBe(25)
    expect((await repo.unfinished()).map((row) => row.id)).toEqual([])
    closeDatabase(db)
  })

  it('takes a delivery back when the budget refuses, so that the account is owed again tomorrow', async () => {
    const db = migratedDatabase()
    const rows = world(db)
    for (const id of ['u-a', 'u-b', 'u-c']) {
      rows.user(id, `${id}@example.test`)
      rows.member(rows.client(), id, 'owner')
    }
    const repo = new SqliteHostAnnouncementRepository(db)
    await repo.create({
      id: 'a-one',
      subject: 'Sujet',
      text: 'Texte',
      link: null,
      createdBy: null,
      createdAt: new Date(AT),
      finishedAt: null,
    })
    const mailer = new FakeMailer()
    const clock = new FakeClock(new Date('2026-11-28T03:00:00.000Z'))
    const sweep = makeSweepHostAnnouncements({
      announcements: repo,
      budget: new FakeMailBudget(2),
      mailer,
      clock,
      logger: new CapturingLogger(),
      operatorContact: null,
    })

    expect(await sweep()).toMatchObject({ sent: 2, heldByBudget: true })
    expect((await repo.listRecent(1))[0]).toMatchObject({ delivered: 2, owed: 3 })
    expect(await repo.pendingRecipients('a-one', 10)).toHaveLength(1)

    clock.set(new Date('2026-11-29T03:00:00.000Z'))
    expect(await sweep()).toMatchObject({ sent: 1, finished: 1 })
    expect(new Set(mailer.sent.map((mail) => mail.to)).size).toBe(3)
    closeDatabase(db)
  })
})
