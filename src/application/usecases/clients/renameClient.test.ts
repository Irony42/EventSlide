import { beforeEach, describe, expect, it } from 'vitest'
import { asClientId } from '../../../domain/shared/ids'
import { aClient } from '../../testing/builders'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { makeRenameClient, type RenameClient } from './renameClient'

const CLIENT = asClientId('client-1')

describe('renameClient', () => {
  let clients: FakeClientRepository
  let renameClient: RenameClient

  beforeEach(() => {
    clients = new FakeClientRepository().seed(aClient({ id: 'client-1', name: 'Atelier Camille' }))
    renameClient = makeRenameClient({ clients })
  })

  it('renames the client and stores the new name', async () => {
    const result = await renameClient({ clientId: CLIENT, name: 'Studio Jean' })

    expect(result.ok && result.value.name.value).toBe('Studio Jean')
    expect((await clients.findById(CLIENT))?.name.value).toBe('Studio Jean')
  })

  it('leaves everything but the name as it was', async () => {
    await clients.save(aClient({ id: 'client-1', ceilings: { maxEvents: 4 }, locale: 'it' }))

    await renameClient({ clientId: CLIENT, name: 'Studio Jean' })

    const stored = await clients.findById(CLIENT)
    expect(stored?.ceilings.maxEvents).toBe(4)
    expect(stored?.locale).toBe('it')
  })

  it('answers client.notFound for a client that does not exist', async () => {
    const result = await renameClient({ clientId: asClientId('ghost'), name: 'Studio Jean' })

    expect(!result.ok && result.error.code).toBe('client.notFound')
    expect(!result.ok && result.error.kind).toBe('notFound')
  })

  it('refuses an invalid name, and keeps the old one', async () => {
    const result = await renameClient({ clientId: CLIENT, name: '' })

    expect(!result.ok && result.error.code).toBe('clientName.empty')
    expect((await clients.findById(CLIENT))?.name.value).toBe('Atelier Camille')
  })
})
