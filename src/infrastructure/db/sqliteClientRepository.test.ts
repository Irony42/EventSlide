import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AT, aClient, anEventSettings } from '../../application/testing/builders'
import {
  CLIENT_CONTRACT_FIXTURES,
  clientRepositoryContract,
} from '../../application/testing/contracts/clientRepositoryContract'
import { asClientId, asEventId, asUserId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqliteClientRepository } from './sqliteClientRepository'

/**
 * The shared contract, plus what it cannot state: the foreign keys are enforced, a
 * plain DELETE of a client that owns an event is refused by the database itself
 * (`events.client_id` is ON DELETE RESTRICT), and a hand-edited row is refused on the
 * way out rather than guessed at.
 */

const OWNER = asUserId('user-owner')

const migratedDb = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  return db
}

/** `AAAAAA`, `BBBBBB`, ... — `events.join_code` is unique across every event. */
const joinCodeFor = (index: number): string => String.fromCodePoint(65 + index).repeat(6)

/** `client_members` references `users`; `events.client_id` references `clients`. */
const seedFixtures = (db: Db): void => {
  const insertUser = db.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
  for (const id of CLIENT_CONTRACT_FIXTURES.userIds) {
    insertUser.run(id, `${id}@example.test`, null, 'hash:un-mot-de-passe-solide', AT.toISOString())
  }

  const insertEvent = db.prepare(
    `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings,
                         quota_bytes, created_at)
     VALUES (?, ?, 'Camille & Sacha', ?, ?, 'live', ?, 1000000000, ?)`,
  )
  CLIENT_CONTRACT_FIXTURES.eventIds.forEach((id, index) => {
    insertEvent.run(
      id,
      CLIENT_CONTRACT_FIXTURES.userIds[0],
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

clientRepositoryContract('sqlite', async () => {
  const db = migratedDb()
  seedFixtures(db)

  return {
    repo: new SqliteClientRepository(db),
    // The column the contract's `contextForEvent` and `deleteIfEmpty` cases are about,
    // written as one statement against the event rows this file already seeded.
    linkEvent: async (eventId, clientId) => {
      db.prepare<[string, string]>(`UPDATE events SET client_id = ? WHERE id = ?`).run(
        clientId,
        eventId,
      )
    },
    dispose: async () => closeDatabase(db),
  }
})

describe('SqliteClientRepository', () => {
  let db: Db
  let repo: SqliteClientRepository

  beforeEach(() => {
    db = migratedDb()
    seedFixtures(db)
    repo = new SqliteClientRepository(db)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  it('refuses a membership whose user does not exist', async () => {
    await repo.save(aClient({ id: 'client-1' }))

    const thrown = await rejectionOf(() =>
      repo.grantMember({
        clientId: asClientId('client-1'),
        userId: asUserId('user-ghost'),
        role: 'member',
        grantedAt: AT,
      }),
    )

    expect(sqliteCodeOf(thrown)).toBe('SQLITE_CONSTRAINT_FOREIGNKEY')
  })

  it('refuses a membership whose client does not exist', async () => {
    const thrown = await rejectionOf(() =>
      repo.grantMember({
        clientId: asClientId('client-ghost'),
        userId: OWNER,
        role: 'member',
        grantedAt: AT,
      }),
    )

    expect(sqliteCodeOf(thrown)).toBe('SQLITE_CONSTRAINT_FOREIGNKEY')
  })

  it('leaves a client that owns an event undeleted even by a plain DELETE (RESTRICT)', async () => {
    await repo.save(aClient({ id: 'client-1' }))
    db.prepare(`UPDATE events SET client_id = 'client-1' WHERE id = 'evt-wedding'`).run()

    expect(() => db.prepare(`DELETE FROM clients WHERE id = 'client-1'`).run()).toThrow(
      /FOREIGN KEY constraint failed/,
    )
  })

  it('stores a boolean ceiling as 0 or 1 and an absent ceiling as NULL', async () => {
    await repo.save(aClient({ id: 'client-1', ceilings: { clipsAllowed: false, maxEvents: null } }))

    expect(db.prepare(`SELECT clips_allowed, live_allowed, max_events FROM clients`).get()).toEqual(
      { clips_allowed: 0, live_allowed: 1, max_events: null },
    )
  })

  it('writes instants as ISO-8601 UTC text', async () => {
    await repo.save(aClient({ id: 'client-1', suspendedAt: AT }))

    expect(db.prepare(`SELECT created_at, suspended_at FROM clients`).get()).toEqual({
      created_at: AT.toISOString(),
      suspended_at: AT.toISOString(),
    })
  })

  it('does not repeat a client on page two when one is created after the cursor was drawn', async () => {
    await repo.save(aClient({ id: 'client-1', createdAt: new Date(AT.getTime() + 1_000) }))
    await repo.save(aClient({ id: 'client-2', createdAt: new Date(AT.getTime() + 2_000) }))
    const first = await repo.list({ limit: 1 })

    // Newer than everything: an OFFSET page would now repeat client-2 on page two.
    await repo.save(aClient({ id: 'client-3', createdAt: new Date(AT.getTime() + 3_000) }))

    const second = await repo.list({ after: asClientId('client-2'), limit: 1 })
    expect(first.items.map((client) => client.id)).toEqual(['client-2'])
    expect(second.items.map((client) => client.id)).toEqual(['client-1'])
  })

  // ------------------------------------------------------------ corrupt rows --

  const corrupt = (column: string, value: string): void => {
    db.pragma('ignore_check_constraints = ON')
    db.prepare(`UPDATE clients SET ${column} = ?`).run(value)
  }

  it('refuses to hydrate a locale outside the five the catalogue defines', async () => {
    await repo.save(aClient({ id: 'client-1' }))
    corrupt('locale', 'pt')

    await expect(repo.findById(asClientId('client-1'))).rejects.toThrow(/clients\.locale/)
  })

  it('refuses to hydrate a name the domain refuses', async () => {
    await repo.save(aClient({ id: 'client-1' }))
    corrupt('name', '   ')

    await expect(repo.findById(asClientId('client-1'))).rejects.toThrow(/clients\.name/)
  })

  it('refuses to hydrate a contact email the domain refuses', async () => {
    await repo.save(aClient({ id: 'client-1' }))
    corrupt('contact_email', 'not-an-email')

    await expect(repo.findById(asClientId('client-1'))).rejects.toThrow(/clients\.contact_email/)
  })

  it('names the column of a corrupt row but never repeats its value, which may be personal data', async () => {
    await repo.save(aClient({ id: 'client-1' }))
    corrupt('contact_email', 'marie.dupont-sans-arobase')

    const thrown = await rejectionOf(() => repo.findById(asClientId('client-1')))
    expect(String(thrown)).toContain('clients.contact_email')
    expect(String(thrown)).not.toContain('marie.dupont')

    corrupt('name', 'Marie Dupont'.repeat(20))
    corrupt('contact_email', 'marie@example.test')
    const nameThrown = await rejectionOf(() => repo.findById(asClientId('client-1')))
    expect(String(nameThrown)).toContain('clients.name')
    expect(String(nameThrown)).not.toContain('Marie Dupont')
  })

  it('refuses to hydrate a timestamp it cannot read', async () => {
    await repo.save(aClient({ id: 'client-1' }))
    corrupt('created_at', 'yesterday-ish')

    await expect(repo.findById(asClientId('client-1'))).rejects.toThrow(/Corrupt timestamp/)
  })

  it('refuses to hydrate a client role outside the two the product defines', async () => {
    await repo.save(aClient({ id: 'client-1' }))
    await repo.grantMember({
      clientId: asClientId('client-1'),
      userId: OWNER,
      role: 'member',
      grantedAt: AT,
    })
    db.pragma('ignore_check_constraints = ON')
    db.prepare(`UPDATE client_members SET role = 'admin'`).run()

    await expect(repo.memberRole(asClientId('client-1'), OWNER)).rejects.toThrow(
      /client_members\.role/,
    )
    await expect(repo.membershipsForUser(OWNER)).rejects.toThrow(/client_members\.role/)
  })

  it('reports an event of no client as having no context, not as an unlimited one', async () => {
    expect(await repo.contextForEvent(asEventId('evt-wedding'))).toBeNull()
  })
})
