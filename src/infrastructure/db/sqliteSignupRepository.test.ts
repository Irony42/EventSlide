import { describe, expect, it } from 'vitest'
import { AT, anAccountToken } from '../../application/testing/builders'
import {
  CONTRACT_ACCOUNTS,
  CONTRACT_CLIENTS,
} from '../../application/testing/contracts/accountTokenRepositoryContract'
import { signupRepositoryContract } from '../../application/testing/contracts/signupRepositoryContract'
import { createSignupRequest } from '../../domain/signups/signupRequest'
import { EmailAddress } from '../../domain/users/emailAddress'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqliteAccountTokenRepository } from './sqliteAccountTokenRepository'
import { SqliteSignupRepository } from './sqliteSignupRepository'

/** The accounts and clients the foreign keys of `signup_requests` and `account_tokens` need. */
const seededDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  const insertUser = db.prepare(
    `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'hash:x', ?)`,
  )
  CONTRACT_ACCOUNTS.forEach((id, index) => {
    insertUser.run(id, `compte-${index}@example.test`, AT.toISOString())
  })
  for (const id of CONTRACT_CLIENTS) {
    db.prepare(`INSERT INTO clients (id, name, created_at) VALUES (?, 'Un client', ?)`).run(
      id,
      AT.toISOString(),
    )
  }
  return db
}

signupRepositoryContract('sqlite', async () => {
  const db = seededDatabase()
  return {
    repo: new SqliteSignupRepository(db),
    tokens: new SqliteAccountTokenRepository(db),
    dispose: async () => closeDatabase(db),
  }
})

const insertRow = (db: Db, id: string, status: string, over: Record<string, string | null> = {}) =>
  db
    .prepare(
      `INSERT INTO signup_requests (id, email, client_name, locale, status, created_at, claimed_at)
            VALUES (?, ?, 'Un espace', 'fr', ?, ?, ?)`,
    )
    .run(
      id,
      over['email'] ?? `${id}@example.test`,
      status,
      AT.toISOString(),
      over['claimed_at'] ?? null,
    )

describe('migration 041, signup_requests', () => {
  it('refuses a status the domain does not have', () => {
    const db = seededDatabase()

    expect(() => insertRow(db, 'r1', 'done')).toThrow(/CHECK/)
    closeDatabase(db)
  })

  it('refuses a claim without its stamp and a stamp without a claim', () => {
    const db = seededDatabase()

    expect(() => insertRow(db, 'r1', 'approving')).toThrow(/CHECK/)
    expect(() => insertRow(db, 'r2', 'pending', { claimed_at: AT.toISOString() })).toThrow(/CHECK/)
    expect(() => insertRow(db, 'r3', 'approving', { claimed_at: AT.toISOString() })).not.toThrow()
    closeDatabase(db)
  })

  it('refuses a second unconfirmed request for one address, and allows it once the first moved', () => {
    const db = seededDatabase()
    insertRow(db, 'r1', 'unconfirmed', { email: 'a@example.test' })

    expect(() => insertRow(db, 'r2', 'unconfirmed', { email: 'a@example.test' })).toThrow(/UNIQUE/)
    db.prepare(`UPDATE signup_requests SET status = 'pending' WHERE id = 'r1'`).run()
    expect(() => insertRow(db, 'r2', 'unconfirmed', { email: 'a@example.test' })).not.toThrow()
    closeDatabase(db)
  })

  it('sets the keys to NULL when the account, the client or the invitation goes, and keeps the request', () => {
    const db = seededDatabase()
    insertRow(db, 'r1', 'approved')
    db.prepare(
      `UPDATE signup_requests SET decided_by = 'user-1', client_id = 'client-1' WHERE id = 'r1'`,
    ).run()

    db.prepare(`DELETE FROM clients WHERE id = 'client-1'`).run()
    db.prepare(`DELETE FROM users WHERE id = 'user-1'`).run()

    expect(
      db.prepare(`SELECT decided_by, client_id FROM signup_requests WHERE id = 'r1'`).get(),
    ).toEqual({ decided_by: null, client_id: null })
    closeDatabase(db)
  })

  it('accepts a confirmation token with no account, which is what the confirmation link is', () => {
    const db = seededDatabase()

    expect(() =>
      db
        .prepare(
          `INSERT INTO account_tokens (id, purpose, token_digest, email, user_id, delivery,
                                       requires_approval, created_at, expires_at)
                VALUES ('t1', 'emailVerification', ?, 'a@example.test', NULL, 'mail', 0, ?, ?)`,
        )
        .run('a'.repeat(64), AT.toISOString(), new Date(AT.getTime() + 1000).toISOString()),
    ).not.toThrow()
    closeDatabase(db)
  })
})

describe('migration 041, the invitation key', () => {
  it('sets invitation_token_id to NULL when the invitation token is deleted, and keeps the request', async () => {
    const db = seededDatabase()
    await new SqliteAccountTokenRepository(db).save(
      anAccountToken({
        id: 'inv-1',
        purpose: 'invitation',
        email: 'a@example.test',
        userId: null,
        clientId: 'client-1',
        clientRole: 'owner',
      }),
    )
    insertRow(db, 'r1', 'approved')
    db.prepare(`UPDATE signup_requests SET invitation_token_id = 'inv-1' WHERE id = 'r1'`).run()

    db.prepare(`DELETE FROM account_tokens WHERE id = 'inv-1'`).run()

    expect(
      db.prepare(`SELECT status, invitation_token_id FROM signup_requests WHERE id = 'r1'`).get(),
    ).toEqual({ status: 'approved', invitation_token_id: null })
    closeDatabase(db)
  })
})

describe('transactions of the SQLite adapter', () => {
  const failTokenUpdates = (db: Db): void => {
    db.exec(
      `CREATE TRIGGER refuse_token_update BEFORE UPDATE ON account_tokens
         BEGIN SELECT RAISE(ABORT, 'token write refused'); END`,
    )
  }

  it('confirm leaves the request unconfirmed when the token cannot be spent', async () => {
    const db = seededDatabase()
    const repo = new SqliteSignupRepository(db)
    const email = EmailAddress.create('camille@example.test')
    if (!email.ok) throw new Error('fixture')
    const made = createSignupRequest(
      {
        id: 'req-1',
        email: email.value,
        clientName: 'Mariage',
        locale: 'fr',
      },
      AT,
    )
    if (!made.ok) throw new Error('fixture')
    const token = anAccountToken({
      id: 'tok-1',
      purpose: 'emailVerification',
      email: 'camille@example.test',
      userId: null,
      createdAt: AT,
    })
    await repo.admit({ request: made.value, token, now: AT, maxPerDay: 10 })
    failTokenUpdates(db)

    await expect(
      repo.confirm({ tokenDigest: token.tokenDigest, now: AT, outcome: 'pending' }),
    ).rejects.toThrow(/token write refused/)

    expect(await repo.findById('req-1')).toMatchObject({ status: 'unconfirmed', confirmedAt: null })
    closeDatabase(db)
  })
})
