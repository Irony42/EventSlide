import { describe, expect, it } from 'vitest'
import { asClientId } from '../../../domain/shared/ids'
import { aClient, anEvent } from '../../testing/builders'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { clientBytesOf, clientContextOf } from './clientContextOf'

/** Counts the reads, so "never asks" is a number and not a belief. */
class CountingClientRepository extends FakeClientRepository {
  contextReads = 0

  override async contextForEvent(
    ...args: Parameters<FakeClientRepository['contextForEvent']>
  ): ReturnType<FakeClientRepository['contextForEvent']> {
    this.contextReads += 1
    return super.contextForEvent(...args)
  }
}

describe('clientContextOf', () => {
  it('is null for an event with no client, without reading the clients at all', async () => {
    const clients = new CountingClientRepository()

    const context = await clientContextOf(clients, anEvent({ clientId: null }))

    expect(context).toBeNull()
    expect(clients.contextReads).toBe(0)
  })

  it('is the client and its ceilings for an event that belongs to one', async () => {
    const clients = new CountingClientRepository().seed(
      aClient({ id: 'client-1', ceilings: { maxTotalBytes: 1_000 } }),
    )
    clients.linkEvent(anEvent({ id: 'event-1', clientId: 'client-1' }).id, asClientId('client-1'))

    const context = await clientContextOf(clients, anEvent({ id: 'event-1', clientId: 'client-1' }))

    expect(context?.clientId).toBe('client-1')
    expect(context?.ceilings.maxTotalBytes).toBe(1_000)
    expect(context?.suspended).toBe(false)
  })
})

describe('clientBytesOf', () => {
  const contextWith = (maxTotalBytes: number | null) => ({
    clientId: asClientId('client-1'),
    ceilings: aClient({ ceilings: { maxTotalBytes } }).ceilings,
    suspended: false,
  })

  it('is null without a client', () => {
    expect(clientBytesOf(null)).toBeNull()
  })

  it('is null for a client with no max_total_bytes, which tells the repository not to read the second sum', () => {
    expect(clientBytesOf(contextWith(null))).toBeNull()
  })

  it('is the client and its ceiling otherwise', () => {
    expect(clientBytesOf(contextWith(5_000))).toEqual({
      clientId: 'client-1',
      maxBytes: 5_000,
    })
  })
})
