import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqliteAccountTokenRepository } from './sqliteAccountTokenRepository'
import { AT, anAccountToken, atPlus } from '../../application/testing/builders'
import {
  accountTokenRepositoryContract,
  CONTRACT_ACCOUNTS,
  CONTRACT_EVENTS,
} from '../../application/testing/contracts/accountTokenRepositoryContract'
import { asAccountTokenId } from '../../domain/shared/ids'

/**
 * `account_tokens` references `users` and `events`, and the contract names accounts and an
 * event the real table must hold. Seeded here with the minimum the foreign keys need.
 */
const seededDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)

  const insertUser = db.prepare(
    `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'hash:x', ?)`,
  )
  CONTRACT_ACCOUNTS.forEach((id, index) => {
    insertUser.run(id, `compte-${index}@example.test`, AT.toISOString())
  })
  for (const id of CONTRACT_EVENTS) {
    db.prepare(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings,
                           quota_bytes, created_at)
            VALUES (?, 'user-1', 'Un soir', ?, 'H7K2QM', 'live', '{}', 1000000000, ?)`,
    ).run(id, id, AT.toISOString())
  }
  return db
}

accountTokenRepositoryContract('sqlite', async () => {
  const db = seededDatabase()

  return {
    repo: new SqliteAccountTokenRepository(db),
    dispose: async () => {
      closeDatabase(db)
    },
  }
})

describe('SqliteAccountTokenRepository', () => {
  let db: Db
  let repo: SqliteAccountTokenRepository

  beforeEach(() => {
    db = seededDatabase()
    repo = new SqliteAccountTokenRepository(db)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  const storedRow = (id: string): Record<string, unknown> | undefined =>
    db.prepare(`SELECT * FROM account_tokens WHERE id = ?`).get(id) as
      Record<string, unknown> | undefined

  it('writes the digest and never anything else that could open the link', async () => {
    const token = anAccountToken({ id: 'tok-1' })
    await repo.save(token)

    const row = storedRow('tok-1')

    expect(row?.['token_digest']).toBe(token.tokenDigest)
    // The only 64-character hex string in the row is the digest; there is no column to put
    // a token in, and none of the others holds anything shaped like one.
    const stringsInRow = Object.values(row ?? {}).filter(
      (value): value is string => typeof value === 'string',
    )
    expect(stringsInRow.filter((value) => /^[0-9a-f]{64}$/.test(value))).toEqual([
      token.tokenDigest,
    ])
  })

  it('stores the instants as ISO-8601 UTC text, which is what the comparisons sort on', async () => {
    await repo.save(anAccountToken({ id: 'tok-1' }))
    await repo.consume(asAccountTokenId('tok-1'), atPlus(1_234))

    expect(storedRow('tok-1')).toMatchObject({
      created_at: AT.toISOString(),
      expires_at: atPlus(60 * 60 * 1000).toISOString(),
      consumed_at: atPlus(1_234).toISOString(),
    })
  })
})
