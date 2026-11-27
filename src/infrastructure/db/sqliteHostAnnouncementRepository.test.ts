import { describe, expect, it } from 'vitest'
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
})
