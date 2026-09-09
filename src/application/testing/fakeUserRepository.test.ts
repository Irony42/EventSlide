import { describe, expect, it } from 'vitest'
import { asUserId } from '../../domain/shared/ids'
import { userRepositoryContract } from './contracts/userRepositoryContract'
import { aUser } from './builders'
import { FakeUserRepository } from './fakeUserRepository'

userRepositoryContract('fake', async () => ({ repo: new FakeUserRepository() }))

describe('FakeUserRepository seeding', () => {
  it('returns itself, so a test arranges its world in one expression', async () => {
    const repo = new FakeUserRepository()

    expect(repo.seed(aUser({ id: 'user-host' }))).toBe(repo)
  })

  it('seeds rows the repository can then read', async () => {
    const repo = new FakeUserRepository().seed(aUser({ id: 'user-host' }))

    expect((await repo.findById(asUserId('user-host')))?.id).toBe('user-host')
  })

  it('refuses a fixture that duplicates an email', async () => {
    expect(() =>
      new FakeUserRepository().seed(
        aUser({ id: 'user-host', email: 'hote@example.test' }),
        aUser({ id: 'user-mod', email: 'hote@example.test' }),
      ),
    ).toThrow(/UNIQUE constraint failed: users.email/)
  })
})
