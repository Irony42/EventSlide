import { describe, expect, it } from 'vitest'
import { asClientId, asEventId } from '../../domain/shared/ids'
import { aClient } from './builders'
import { clientRepositoryContract } from './contracts/clientRepositoryContract'
import { FakeClientRepository } from './fakeClientRepository'

clientRepositoryContract('fake', async () => {
  const repo = new FakeClientRepository()
  return {
    repo,
    linkEvent: async (eventId, clientId) => {
      repo.linkEvent(eventId, clientId)
    },
  }
})

describe('FakeClientRepository seeding', () => {
  it('returns itself from seed and linkEvent, so a test arranges its world in one expression', () => {
    const repo = new FakeClientRepository()

    expect(repo.seed(aClient())).toBe(repo)
    expect(repo.linkEvent(asEventId('evt-1'), asClientId('client-1'))).toBe(repo)
  })

  it('refuses a link to a client that was never seeded, like the foreign key it stands in for', async () => {
    const repo = new FakeClientRepository().linkEvent(asEventId('evt-1'), asClientId('ghost'))

    await expect(repo.contextForEvent(asEventId('evt-1'))).rejects.toThrow(/no such client/)
  })
})
