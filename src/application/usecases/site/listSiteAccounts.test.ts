import { beforeEach, describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import { aUser } from '../../testing/builders'
import { FakeSiteOverview } from '../../testing/fakeSiteOverview'
import { makeListSiteAccounts } from './listSiteAccounts'
import { DEFAULT_SITE_PAGE_SIZE } from './sitePageLimit'

/**
 * What `listSiteAccounts` adds to the read model: the page size is checked before it is asked, and
 * the cursor of the previous page reaches it, when there is one and not otherwise. The rows are
 * the port's (`siteOverviewContract`); the route that serves them is `siteRoutes.accounts.test.ts`.
 */
describe('listSiteAccounts', () => {
  let overview: FakeSiteOverview

  beforeEach(async () => {
    overview = new FakeSiteOverview()
    await overview.addAccount(aUser({ id: 'user-a', email: 'a@example.test' }))
    await overview.addAccount(aUser({ id: 'user-b', email: 'b@example.test' }))
  })

  it('hands the read model the default page size and no cursor for a first page', async () => {
    const asked: unknown[] = []
    const listAccounts = makeListSiteAccounts({
      overview: {
        listAccounts: (page) => {
          asked.push(page)
          return overview.listAccounts(page)
        },
      },
    })

    await listAccounts({})

    expect(asked).toEqual([{ limit: DEFAULT_SITE_PAGE_SIZE }])
  })

  it('hands the read model the cursor of the previous page, so the next page starts after it', async () => {
    const listAccounts = makeListSiteAccounts({ overview })
    const first = await listAccounts({ limit: 1 })
    if (!first.ok || first.value.next === null) throw new Error('fixture rejected')

    const second = await listAccounts({ limit: 1, after: first.value.next })

    expect(second.ok && second.value.items.map((row) => row.id)).not.toEqual(
      first.value.items.map((row) => row.id),
    )
    expect(second.ok && second.value.items).toHaveLength(1)
    expect(second.ok && second.value.next).toBeNull()
  })

  it('passes the cursor it was given through unchanged', async () => {
    const asked: unknown[] = []
    const listAccounts = makeListSiteAccounts({
      overview: {
        listAccounts: (page) => {
          asked.push(page)
          return overview.listAccounts(page)
        },
      },
    })

    await listAccounts({ limit: 5, after: asUserId('user-a') })

    expect(asked).toEqual([{ limit: 5, after: 'user-a' }])
  })

  it('refuses a page size outside the bound, and never asks the read model', async () => {
    let asked = false
    const listAccounts = makeListSiteAccounts({
      overview: {
        listAccounts: (page) => {
          asked = true
          return overview.listAccounts(page)
        },
      },
    })

    const result = await listAccounts({ limit: 0 })

    expect(!result.ok && result.error.code).toBe('site.pageLimitInvalid')
    expect(asked).toBe(false)
  })
})
