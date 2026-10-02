import { beforeEach, describe, expect, it } from 'vitest'
import { asClientId } from '../../../domain/shared/ids'
import { AT, aClient, atPlus } from '../../testing/builders'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { makeSetClientCeilings, type SetClientCeilings } from './setClientCeilings'

const CLIENT = asClientId('client-1')

describe('setClientCeilings', () => {
  let clients: FakeClientRepository
  let setClientCeilings: SetClientCeilings

  beforeEach(() => {
    clients = new FakeClientRepository().seed(
      aClient({
        id: 'client-1',
        ceilings: { maxEvents: 5, maxRetentionDays: 90, periodStartedAt: AT },
        eventsCreatedInPeriod: 4,
      }),
    )
    setClientCeilings = makeSetClientCeilings({ clients })
  })

  it('applies the ceiling it was given and stores it', async () => {
    const result = await setClientCeilings({ clientId: CLIENT, ceilings: { maxTotalBytes: 1_000 } })

    expect(result.ok && result.value.ceilings.maxTotalBytes).toBe(1_000)
    expect((await clients.findById(CLIENT))?.ceilings.maxTotalBytes).toBe(1_000)
  })

  it('keeps every ceiling the patch does not mention, so raising one number lifts no other', async () => {
    await setClientCeilings({ clientId: CLIENT, ceilings: { maxTotalBytes: 1_000 } })

    const stored = await clients.findById(CLIENT)
    expect(stored?.ceilings.maxEvents).toBe(5)
    expect(stored?.ceilings.maxRetentionDays).toBe(90)
  })

  it('removes a ceiling when the patch says null', async () => {
    await setClientCeilings({ clientId: CLIENT, ceilings: { maxEvents: null } })

    expect((await clients.findById(CLIENT))?.ceilings.maxEvents).toBeNull()
  })

  it('answers client.notFound for a client that does not exist', async () => {
    const result = await setClientCeilings({
      clientId: asClientId('ghost'),
      ceilings: { maxEvents: 1 },
    })

    expect(!result.ok && result.error.code).toBe('client.notFound')
  })

  it('refuses a ceiling outside the catalogue bounds, and keeps the old ones', async () => {
    const result = await setClientCeilings({ clientId: CLIENT, ceilings: { maxEvents: 0 } })

    expect(!result.ok && result.error.code).toBe('clientCeilings.maxEventsInvalid')
    expect((await clients.findById(CLIENT))?.ceilings.maxEvents).toBe(5)
  })

  // ------------------------------------------------------ the per-period counter --

  it('leaves the per-period counter alone on an ordinary edit', async () => {
    await setClientCeilings({ clientId: CLIENT, ceilings: { maxEvents: 6 } })

    expect((await clients.findById(CLIENT))?.eventsCreatedInPeriod).toBe(4)
  })

  it('leaves the counter alone when the patch restates the same period instant', async () => {
    await setClientCeilings({ clientId: CLIENT, ceilings: { periodStartedAt: new Date(AT) } })

    expect((await clients.findById(CLIENT))?.eventsCreatedInPeriod).toBe(4)
  })

  it('resets the counter to zero when the period is renewed', async () => {
    const result = await setClientCeilings({
      clientId: CLIENT,
      ceilings: { periodStartedAt: atPlus(86_400_000) },
    })

    expect(result.ok && result.value.eventsCreatedInPeriod).toBe(0)
    expect((await clients.findById(CLIENT))?.eventsCreatedInPeriod).toBe(0)
  })
})
