import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AT, anAccountToken, aUser, atPlus } from '../../application/testing/builders'
import {
  ACCEPTANCE_ACCOUNTS,
  ACCEPTANCE_CLIENT,
  ACCEPTANCE_EVENT,
  ACCEPTANCE_HOST,
  invitationAcceptanceContract,
} from '../../application/testing/contracts/invitationAcceptanceContract'
import { asAccountTokenId, asClientId, asEventId, asUserId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqliteAccountTokenRepository } from './sqliteAccountTokenRepository'
import { SqliteClientRepository } from './sqliteClientRepository'
import { SqliteInvitationAcceptance } from './sqliteInvitationAcceptance'
import { SqliteMembershipRepository } from './sqliteMembershipRepository'
import { SqliteUserRepository } from './sqliteUserRepository'

/**
 * The shared contract over the real tables, plus what it cannot state about them: that the
 * writes really are one transaction (an injected failure after the spend leaves no spend),
 * and that nothing sensitive is written beside the account.
 */

const seededDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)

  const insertUser = db.prepare(
    `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'hash:x', ?)`,
  )
  for (const id of ACCEPTANCE_ACCOUNTS) insertUser.run(id, `${id}@example.test`, AT.toISOString())

  db.prepare(
    `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings,
                         quota_bytes, created_at)
          VALUES (?, ?, 'Un soir', 'un-soir', 'H7K2QM', 'live', '{}', 1000000000, ?)`,
  ).run(ACCEPTANCE_EVENT, ACCEPTANCE_HOST, AT.toISOString())
  db.prepare(
    `INSERT INTO event_memberships (event_id, user_id, role, granted_at)
          VALUES (?, ?, 'owner', ?)`,
  ).run(ACCEPTANCE_EVENT, ACCEPTANCE_HOST, AT.toISOString())
  db.prepare(`INSERT INTO clients (id, name, created_at) VALUES (?, 'Un client', ?)`).run(
    ACCEPTANCE_CLIENT,
    AT.toISOString(),
  )
  return db
}

invitationAcceptanceContract('sqlite', async () => {
  const db = seededDatabase()

  return {
    acceptance: new SqliteInvitationAcceptance(db),
    tokens: new SqliteAccountTokenRepository(db),
    users: new SqliteUserRepository(db),
    memberships: new SqliteMembershipRepository(db),
    clients: new SqliteClientRepository(db),
    dispose: async () => {
      closeDatabase(db)
    },
  }
})

describe('SqliteInvitationAcceptance', () => {
  let db: Db
  let acceptance: SqliteInvitationAcceptance
  let tokens: SqliteAccountTokenRepository

  beforeEach(async () => {
    db = seededDatabase()
    acceptance = new SqliteInvitationAcceptance(db)
    tokens = new SqliteAccountTokenRepository(db)
    await tokens.save(
      anAccountToken({
        id: 'tok-1',
        purpose: 'invitation',
        email: 'nouveau@example.test',
        userId: null,
        eventId: ACCEPTANCE_EVENT,
        eventRole: 'moderator',
        delivery: 'mail',
        createdBy: ACCEPTANCE_HOST,
      }),
    )
  })

  afterEach(() => {
    closeDatabase(db)
  })

  const count = (table: string): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

  it('rolls the whole acceptance back when a write after the spend fails, so the link is not lost', async () => {
    // A grant naming a place that does not exist fails on its foreign key, after the link was
    // spent and the account inserted. Neither may survive it.
    const accounts = count('users')

    await expect(
      acceptance.accept({
        tokenId: asAccountTokenId('tok-1'),
        now: atPlus(1_000),
        account: { kind: 'new', user: aUser({ id: 'user-new', email: 'nouveau@example.test' }) },
        grant: { kind: 'client', clientId: asClientId('client-gone'), role: 'owner' },
      }),
    ).rejects.toThrow(/FOREIGN KEY/)

    expect(count('users')).toBe(accounts)
    expect(db.prepare(`SELECT consumed_at FROM account_tokens WHERE id = 'tok-1'`).get()).toEqual({
      consumed_at: null,
    })
  })

  it('leaves the connection outside a transaction after a refusal, which is a return and not an exception', async () => {
    await acceptance.accept({
      tokenId: asAccountTokenId('tok-nobody'),
      now: atPlus(1_000),
      account: { kind: 'existing', userId: asUserId('user-existing'), emailVerifiedAt: null },
      grant: { kind: 'event', eventId: asEventId(ACCEPTANCE_EVENT), role: 'moderator' },
    })

    expect(db.inTransaction).toBe(false)
  })

  it('writes the spend instant and the grant instant from the same clock reading', async () => {
    await acceptance.accept({
      tokenId: asAccountTokenId('tok-1'),
      now: atPlus(1_234),
      account: { kind: 'existing', userId: asUserId('user-existing'), emailVerifiedAt: null },
      grant: { kind: 'event', eventId: asEventId(ACCEPTANCE_EVENT), role: 'moderator' },
    })

    expect(db.prepare(`SELECT consumed_at FROM account_tokens WHERE id = 'tok-1'`).get()).toEqual({
      consumed_at: atPlus(1_234).toISOString(),
    })
    expect(
      db.prepare(`SELECT granted_at FROM event_memberships WHERE user_id = 'user-existing'`).get(),
    ).toEqual({ granted_at: atPlus(1_234).toISOString() })
  })
})
