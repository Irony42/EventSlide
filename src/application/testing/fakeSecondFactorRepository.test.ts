import { describe, expect, it } from 'vitest'
import { asUserId } from '../../domain/shared/ids'
import { AT } from './builders'
import {
  CONTRACT_ACCOUNTS,
  secondFactorRepositoryContract,
} from './contracts/secondFactorRepositoryContract'
import { FakeSecondFactorRepository } from './fakeSecondFactorRepository'

secondFactorRepositoryContract('fake', async () => ({
  repo: new FakeSecondFactorRepository().withAccounts(...CONTRACT_ACCOUNTS.map(asUserId)),
}))

describe('FakeSecondFactorRepository', () => {
  const USER = asUserId('user-1')
  const SEALED = 'aXY.dGFn.Y2lwaGVydGV4dA'

  it('knows no account until it is told, so an enrolment naming one is refused', async () => {
    const repo = new FakeSecondFactorRepository()

    await expect(repo.beginEnrolment(USER, SEALED, 1, AT)).rejects.toThrow(/FOREIGN KEY/)
  })

  it.each(['GEZDGNBVGY3TQOJQ', 'one.dot', 'a.b.c.d', 'a b.c.d'])(
    'refuses %j as a sealed secret, as the table does: only iv.tag.ciphertext has two dots',
    async (clear) => {
      const repo = new FakeSecondFactorRepository().withAccounts(USER)

      await expect(repo.beginEnrolment(USER, clear, 1, AT)).rejects.toThrow(/CHECK/)
    },
  )

  it.each([0, -1, 1.5])('refuses the key version %s', async (version) => {
    const repo = new FakeSecondFactorRepository().withAccounts(USER)

    await expect(repo.beginEnrolment(USER, SEALED, version, AT)).rejects.toThrow(/CHECK/)
  })

  it('refuses a recovery code that is not a SHA-256 digest, and a duplicate one', async () => {
    const repo = new FakeSecondFactorRepository().withAccounts(USER)
    await repo.beginEnrolment(USER, SEALED, 1, AT)

    await expect(repo.confirmEnrolment(USER, SEALED, 1, AT, ['K7QM-2XTR'])).rejects.toThrow(/CHECK/)
    await expect(
      repo.confirmEnrolment(USER, SEALED, 1, AT, ['a'.repeat(64), 'a'.repeat(64)]),
    ).rejects.toThrow(/UNIQUE/)
    expect(await repo.find(USER)).toMatchObject({ confirmedAt: null })
  })

  it('says what it holds, for a test to look at', async () => {
    const repo = new FakeSecondFactorRepository().withAccounts(USER)
    expect(repo.has(USER)).toBe(false)
    expect(repo.digestsOf(USER)).toEqual([])

    await repo.beginEnrolment(USER, SEALED, 1, AT)
    await repo.confirmEnrolment(USER, SEALED, 1, AT, ['a'.repeat(64)])

    expect(repo.has(USER)).toBe(true)
    expect(repo.digestsOf(USER)).toEqual(['a'.repeat(64)])
  })
})
