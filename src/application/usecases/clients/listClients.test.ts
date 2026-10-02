import { beforeEach, describe, expect, it } from 'vitest'
import { asClientId } from '../../../domain/shared/ids'
import { AT, aClient, atPlus } from '../../testing/builders'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import {
  DEFAULT_CLIENT_PAGE_SIZE,
  MAX_CLIENT_PAGE_SIZE,
  makeListClients,
  type ListClients,
} from './listClients'

describe('listClients', () => {
  let clients: FakeClientRepository
  let listClients: ListClients

  beforeEach(() => {
    clients = new FakeClientRepository().seed(
      aClient({ id: 'client-1', createdAt: AT }),
      aClient({ id: 'client-2', createdAt: atPlus(1_000) }),
      aClient({ id: 'client-3', createdAt: atPlus(2_000) }),
    )
    listClients = makeListClients({ clients })
  })

  it('lists clients newest first', async () => {
    const result = await listClients({})

    expect(result.ok && result.value.items.map((client) => client.id)).toEqual([
      'client-3',
      'client-2',
      'client-1',
    ])
  })

  it('defaults to a page large enough that a small box is one page', async () => {
    expect(DEFAULT_CLIENT_PAGE_SIZE).toBeGreaterThanOrEqual(3)

    const result = await listClients({})

    expect(result.ok && result.value.next).toBeNull()
  })

  it('pages with the cursor the previous page returned', async () => {
    const first = await listClients({ limit: 2 })
    expect(first.ok && first.value.next).toBe('client-2')

    const second = await listClients({ after: asClientId('client-2'), limit: 2 })

    expect(second.ok && second.value.items.map((client) => client.id)).toEqual(['client-1'])
    expect(second.ok && second.value.next).toBeNull()
  })

  it('accepts the largest page it allows', async () => {
    expect((await listClients({ limit: MAX_CLIENT_PAGE_SIZE })).ok).toBe(true)
  })

  it.each([0, -1, 1.5, MAX_CLIENT_PAGE_SIZE + 1, Number.POSITIVE_INFINITY, Number.NaN])(
    'refuses a page size of %s, which the adapter would interpolate into a LIMIT',
    async (limit) => {
      const result = await listClients({ limit })

      expect(!result.ok && result.error.code).toBe('client.pageLimitInvalid')
      expect(!result.ok && result.error.details).toEqual({ max: MAX_CLIENT_PAGE_SIZE })
    },
  )
})
