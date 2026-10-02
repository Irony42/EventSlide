import { describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../domain/shared/ids'
import { anAccountToken } from './builders'
import {
  accountTokenRepositoryContract,
  CONTRACT_ACCOUNTS,
  CONTRACT_EVENTS,
} from './contracts/accountTokenRepositoryContract'
import { FakeAccountTokenRepository } from './fakeAccountTokenRepository'

accountTokenRepositoryContract('fake', async () => ({
  repo: new FakeAccountTokenRepository()
    .withAccounts(...CONTRACT_ACCOUNTS.map(asUserId))
    .withEvents(...CONTRACT_EVENTS.map(asEventId)),
}))

describe('FakeAccountTokenRepository', () => {
  it('knows no account until it is told, so a token naming one is refused', async () => {
    const repo = new FakeAccountTokenRepository()

    await expect(repo.save(anAccountToken({ id: 'tok-1' }))).rejects.toThrow(/FOREIGN KEY/)
  })

  it('refuses a token that would expire before it was issued, as the table does', async () => {
    const repo = new FakeAccountTokenRepository().withAccounts(asUserId('user-1'))

    const impossible = anAccountToken({ id: 'tok-1', expiresAt: new Date(0) })

    await expect(repo.save(impossible)).rejects.toThrow(/CHECK/)
  })

  it('lists what it holds, in the order it was issued', async () => {
    const repo = new FakeAccountTokenRepository().withAccounts(asUserId('user-1'))
    await repo.save(anAccountToken({ id: 'tok-b' }))
    await repo.save(anAccountToken({ id: 'tok-a' }))

    expect(repo.all.map((token) => token.id)).toEqual(['tok-b', 'tok-a'])
  })
})
