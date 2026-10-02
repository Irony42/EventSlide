import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqliteSecondFactorRepository } from './sqliteSecondFactorRepository'
import { AT, atPlus } from '../../application/testing/builders'
import {
  CONTRACT_ACCOUNTS,
  secondFactorRepositoryContract,
} from '../../application/testing/contracts/secondFactorRepositoryContract'
import { asUserId } from '../../domain/shared/ids'

/** `user_totp` references `users`, so the accounts the contract names must exist. */
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

secondFactorRepositoryContract('sqlite', async () => {
  const db = seededDatabase()

  return {
    repo: new SqliteSecondFactorRepository(db),
    dispose: async () => {
      closeDatabase(db)
    },
  }
})

describe('SqliteSecondFactorRepository', () => {
  const USER = asUserId('user-1')
  const SEALED = 'aXY.dGFn.Y2lwaGVydGV4dA'
  let db: Db
  let repo: SqliteSecondFactorRepository

  beforeEach(() => {
    db = seededDatabase()
    repo = new SqliteSecondFactorRepository(db)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  it('writes the sealed text and nothing else of the secret', async () => {
    await repo.beginEnrolment(USER, SEALED, 1, AT)

    expect(db.prepare(`SELECT secret_enc, created_at FROM user_totp`).all()).toEqual([
      { secret_enc: SEALED, created_at: AT.toISOString() },
    ])
  })

  it('writes the digests it was given, in the table the recovery codes live in', async () => {
    await repo.beginEnrolment(USER, SEALED, 1, AT)
    await repo.confirmEnrolment(USER, 7, atPlus(1_000), ['c'.repeat(64)])

    expect(
      db.prepare(`SELECT user_id, code_digest, used_at FROM user_recovery_codes`).all(),
    ).toEqual([{ user_id: 'user-1', code_digest: 'c'.repeat(64), used_at: null }])
  })

  it('installs no code at all when one of them is not a digest: the confirmation rolls back', async () => {
    await repo.beginEnrolment(USER, SEALED, 1, AT)

    await expect(
      repo.confirmEnrolment(USER, 7, atPlus(1_000), ['c'.repeat(64), 'not-a-digest']),
    ).rejects.toThrow(/CHECK/)

    expect(await repo.find(USER)).toMatchObject({ confirmedAt: null, lastUsedStep: null })
    expect(await repo.unusedRecoveryDigests(USER)).toEqual([])
  })

  it('keeps the old codes when a replacement fails half-way', async () => {
    await repo.beginEnrolment(USER, SEALED, 1, AT)
    await repo.confirmEnrolment(USER, 7, atPlus(1_000), ['c'.repeat(64)])

    await expect(repo.replaceRecoveryCodes(USER, ['d'.repeat(64), 'not-a-digest'])).rejects.toThrow(
      /CHECK/,
    )

    expect(await repo.unusedRecoveryDigests(USER)).toEqual(['c'.repeat(64)])
  })

  it('takes the factor with the account that owned it', async () => {
    await repo.beginEnrolment(USER, SEALED, 1, AT)
    await repo.confirmEnrolment(USER, 7, atPlus(1_000), ['c'.repeat(64)])

    db.prepare(`DELETE FROM users WHERE id = 'user-1'`).run()

    expect(await repo.find(USER)).toBeNull()
    expect(db.prepare(`SELECT COUNT(*) AS n FROM user_recovery_codes`).get()).toEqual({ n: 0 })
  })
})
