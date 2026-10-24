import { describe, expect, it } from 'vitest'
import { asClientId, asEventId } from '../../domain/shared/ids'
import { aClient } from './builders'
import { CountingClientRepository } from './countingClientRepository'

describe('CountingClientRepository', () => {
  const EVENT = asEventId('event-1')
  const CLIENT = asClientId('client-1')

  it('has read nothing until it is asked', () => {
    expect(new CountingClientRepository().contextReads).toBe(0)
  })

  it('counts every lookup, whether or not the event has a client', async () => {
    const clients = new CountingClientRepository()
      .seed(aClient({ id: 'client-1' }))
      .linkEvent(EVENT, CLIENT)

    await clients.contextForEvent(EVENT)
    await clients.contextForEvent(asEventId('event-without-client'))

    expect(clients.contextReads).toBe(2)
  })

  it('still answers as the fake does', async () => {
    const clients = new CountingClientRepository()
      .seed(aClient({ id: 'client-1', ceilings: { maxTotalBytes: 1_000 } }))
      .linkEvent(EVENT, CLIENT)

    const context = await clients.contextForEvent(EVENT)

    expect(context?.clientId).toBe(CLIENT)
    expect(context?.ceilings.maxTotalBytes).toBe(1_000)
    expect(context?.suspended).toBe(false)
  })
})
