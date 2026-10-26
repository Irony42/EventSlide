import { beforeEach, describe, expect, it } from 'vitest'
import { asClientId, asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, aClient, aUser, anAuditEntry, anEvent, atPlus } from '../../testing/builders'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeSiteOverview } from '../../testing/fakeSiteOverview'
import { makeListSiteAccounts } from './listSiteAccounts'
import { makeListSiteAudit } from './listSiteAudit'
import { makeListSiteClientEvents } from './listSiteClientEvents'
import { makeListSiteClients } from './listSiteClients'
import { DEFAULT_SITE_PAGE_SIZE, MAX_SITE_PAGE_SIZE, parseSitePageLimit } from './sitePageLimit'

/**
 * The four reads of the operator's namespace (`/api/site`, G2-14), over the in-memory read model.
 *
 * What is held here is what the use cases add to the port: the page size is one bound for all
 * of them, a client that is not there is `client.notFound` and not an empty page, and the log is
 * read filtered or whole. What the rows may contain at all is the port's, held by
 * `siteOverviewContract` against the fake **and** SQLite, and what comes out of the wire is
 * swept in `siteRoutes.contentFree.test.ts`.
 */

const CLIENT_A = asClientId('client-a')
const CLIENT_B = asClientId('client-b')

describe('parseSitePageLimit', () => {
  it('answers the default when none was asked for', () => {
    const result = parseSitePageLimit(undefined)

    expect(result.ok && result.value).toBe(DEFAULT_SITE_PAGE_SIZE)
  })

  it('accepts one and the maximum', () => {
    expect(parseSitePageLimit(1).ok).toBe(true)
    expect(parseSitePageLimit(MAX_SITE_PAGE_SIZE).ok).toBe(true)
  })

  it.each([
    ['zero, which reads nothing', 0],
    ['a negative number, which SQLite would read as "no limit"', -1],
    ['one over the maximum', MAX_SITE_PAGE_SIZE + 1],
    ['a fraction', 1.5],
    ['infinity', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
  ])('refuses %s', (_label, limit) => {
    const result = parseSitePageLimit(limit)

    expect(!result.ok && result.error.code).toBe('site.pageLimitInvalid')
    expect(!result.ok && result.error.kind).toBe('invalid')
  })
})

describe('the operator’s listings', () => {
  let overview: FakeSiteOverview
  let audit: FakeAuditLog

  beforeEach(async () => {
    overview = new FakeSiteOverview()
    audit = new FakeAuditLog().withAccounts(asUserId('user-operator'))
    await overview.addAccount(
      aUser({ id: 'user-operator', email: 'ops@example.test', siteRole: 'operator' }),
    )
    await overview.addAccount(aUser({ id: 'user-owner', email: 'proprio@example.test' }))
    await overview.addClient(aClient({ id: 'client-a', name: 'Atelier A', createdAt: AT }))
    await overview.addClient(
      aClient({ id: 'client-b', name: 'Atelier B', createdAt: atPlus(1_000) }),
    )
    await overview.addEvent(
      anEvent({ id: 'event-1', clientId: 'client-a', ownerId: 'user-owner', name: 'Secret' }),
    )
  })

  describe('listSiteClients', () => {
    it('lists the clients newest first, with what they use', async () => {
      const result = await makeListSiteClients({ overview })({})

      expect(result.ok && result.value.items.map((row) => row.id)).toEqual([CLIENT_B, CLIENT_A])
      expect(result.ok && result.value.items[1]?.usage.eventCount).toBe(1)
    })

    it('pages by the cursor it handed out', async () => {
      const first = await makeListSiteClients({ overview })({ limit: 1 })
      if (!first.ok) throw new Error('fixture rejected')

      const second = await makeListSiteClients({ overview })({
        limit: 1,
        ...(first.value.next === null ? {} : { after: first.value.next }),
      })

      expect(first.value.items.map((row) => row.id)).toEqual([CLIENT_B])
      expect(second.ok && second.value.items.map((row) => row.id)).toEqual([CLIENT_A])
      expect(second.ok && second.value.next).toBeNull()
    })

    it('refuses a page size outside the bound, and never asks the read model', async () => {
      let asked = false
      const spying = {
        listClients: async () => {
          asked = true
          return { items: [], next: null }
        },
      }

      const result = await makeListSiteClients({ overview: spying })({ limit: 0 })

      expect(!result.ok && result.error.code).toBe('site.pageLimitInvalid')
      expect(asked).toBe(false)
    })
  })

  describe('listSiteClientEvents', () => {
    it('lists one client’s events as shapes and sizes', async () => {
      const result = await makeListSiteClientEvents({ overview })({ clientId: CLIENT_A })

      expect(result.ok && result.value.items.map((row) => row.id)).toEqual([asEventId('event-1')])
    })

    it('answers an empty page for a client with no event, which is not the same as no client', async () => {
      const result = await makeListSiteClientEvents({ overview })({ clientId: CLIENT_B })

      expect(result.ok && result.value.items).toEqual([])
    })

    it('answers client.notFound for a client that does not exist', async () => {
      const result = await makeListSiteClientEvents({ overview })({
        clientId: asClientId('ghost'),
      })

      expect(!result.ok && result.error.code).toBe('client.notFound')
      expect(!result.ok && result.error.kind).toBe('notFound')
    })

    it('answers an empty page, and not the first page, for a cursor that is another client’s event', async () => {
      await overview.addEvent(
        anEvent({ id: 'event-2', clientId: 'client-b', ownerId: 'user-owner' }),
      )

      const result = await makeListSiteClientEvents({ overview })({
        clientId: CLIENT_A,
        after: asEventId('event-2'),
      })

      expect(result.ok && result.value.items).toEqual([])
    })

    it('refuses a page size outside the bound before it looks for the client', async () => {
      const result = await makeListSiteClientEvents({ overview })({
        clientId: asClientId('ghost'),
        limit: MAX_SITE_PAGE_SIZE + 1,
      })

      expect(!result.ok && result.error.code).toBe('site.pageLimitInvalid')
    })
  })

  describe('listSiteAccounts', () => {
    it('lists the accounts newest first, by address and by what they belong to, with no hash', async () => {
      const result = await makeListSiteAccounts({ overview })({})

      expect(result.ok && result.value.items.map((row) => row.email).sort()).toEqual([
        'ops@example.test',
        'proprio@example.test',
      ])
      expect(JSON.stringify(result.ok && result.value)).not.toContain('passwordHash')
    })

    it('refuses a page size outside the bound', async () => {
      const result = await makeListSiteAccounts({ overview })({ limit: -5 })

      expect(!result.ok && result.error.code).toBe('site.pageLimitInvalid')
    })
  })

  describe('listSiteAudit', () => {
    beforeEach(async () => {
      await audit.record(anAuditEntry({ clientId: 'client-a', at: atPlus(1) }))
      await audit.record(anAuditEntry({ clientId: 'client-b', at: atPlus(2) }))
      await audit.record(anAuditEntry({ clientId: 'client-a', at: atPlus(3) }))
    })

    it('reads every line on the box when no client is named: the operator’s view is unfiltered', async () => {
      const result = await makeListSiteAudit({ audit })({})

      expect(result.ok && result.value.items.map((row) => row.clientId)).toEqual([
        CLIENT_A,
        CLIENT_B,
        CLIENT_A,
      ])
    })

    it('reads only one client’s lines when one is named', async () => {
      const result = await makeListSiteAudit({ audit })({ clientId: CLIENT_B })

      expect(result.ok && result.value.items.map((row) => row.clientId)).toEqual([CLIENT_B])
    })

    it('pages with before, newest first, and ends with a null cursor', async () => {
      const first = await makeListSiteAudit({ audit })({ limit: 2 })
      if (!first.ok || first.value.next === null) throw new Error('fixture rejected')

      const second = await makeListSiteAudit({ audit })({ limit: 2, before: first.value.next })

      expect(first.value.items).toHaveLength(2)
      expect(second.ok && second.value.items).toHaveLength(1)
      expect(second.ok && second.value.next).toBeNull()
    })

    it('refuses a page size outside the bound', async () => {
      const result = await makeListSiteAudit({ audit })({ limit: 1_000 })

      expect(!result.ok && result.error.code).toBe('site.pageLimitInvalid')
    })
  })
})
