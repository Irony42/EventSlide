import { beforeEach, describe, expect, it } from 'vitest'
import { asClientId, asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, aClient } from '../../testing/builders'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { makeDeleteEmptyClient, type DeleteEmptyClient } from './deleteEmptyClient'

const CLIENT = asClientId('client-1')

describe('deleteEmptyClient', () => {
  let clients: FakeClientRepository
  let deleteEmptyClient: DeleteEmptyClient

  beforeEach(() => {
    clients = new FakeClientRepository().seed(aClient({ id: 'client-1' }))
    deleteEmptyClient = makeDeleteEmptyClient({ clients })
  })

  it('deletes a client with no member and no event', async () => {
    const result = await deleteEmptyClient({ clientId: CLIENT })

    expect(result.ok).toBe(true)
    expect(await clients.findById(CLIENT)).toBeNull()
  })

  it('answers client.notFound for a client that does not exist', async () => {
    const result = await deleteEmptyClient({ clientId: asClientId('ghost') })

    expect(!result.ok && result.error.code).toBe('client.notFound')
    expect(!result.ok && result.error.kind).toBe('notFound')
  })

  it('refuses a client that still has a member, and keeps it', async () => {
    await clients.grantMember({
      clientId: CLIENT,
      userId: asUserId('user-owner'),
      role: 'owner',
      grantedAt: AT,
    })

    const result = await deleteEmptyClient({ clientId: CLIENT })

    expect(!result.ok && result.error.code).toBe('client.notEmpty')
    expect(!result.ok && result.error.kind).toBe('conflict')
    expect(await clients.findById(CLIENT)).not.toBeNull()
  })

  it('refuses a client that still owns an event, and keeps it', async () => {
    clients.linkEvent(asEventId('evt-wedding'), CLIENT)

    const result = await deleteEmptyClient({ clientId: CLIENT })

    expect(!result.ok && result.error.code).toBe('client.notEmpty')
    expect(await clients.findById(CLIENT)).not.toBeNull()
  })

  it('deletes only the client it was asked about', async () => {
    clients.seed(aClient({ id: 'client-2' }))

    await deleteEmptyClient({ clientId: CLIENT })

    expect(await clients.findById(asClientId('client-2'))).not.toBeNull()
  })
})
