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

describe('FakeClientRepository counter and links', () => {
  it('moves the per-period counter up by one for each event recorded', async () => {
    const repo = new FakeClientRepository().seed(aClient({ id: 'client-1' }))

    repo.recordEventCreated(asClientId('client-1')).recordEventCreated(asClientId('client-1'))

    expect((await repo.findById(asClientId('client-1')))?.eventsCreatedInPeriod).toBe(2)
  })

  it('refuses to count an event for a client that was never seeded, like the foreign key it stands in for', () => {
    expect(() => new FakeClientRepository().recordEventCreated(asClientId('ghost'))).toThrow(
      /FOREIGN KEY constraint failed/,
    )
  })

  it('stops reporting an event as the client’s once it is unlinked, so the client can be deleted again', async () => {
    const repo = new FakeClientRepository()
      .seed(aClient({ id: 'client-1' }))
      .linkEvent(asEventId('evt-1'), asClientId('client-1'))
    expect(await repo.deleteIfEmpty(asClientId('client-1'))).toBe(false)

    repo.unlinkEvent(asEventId('evt-1'))

    expect(await repo.contextForEvent(asEventId('evt-1'))).toBeNull()
    expect(await repo.deleteIfEmpty(asClientId('client-1'))).toBe(true)
  })
})
