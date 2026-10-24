import { describe, expect, it } from 'vitest'
import { MAX_SITE_PAGE_SIZE } from '../../../application/usecases/site/sitePageLimit'
import {
  siteAccountsQuery,
  siteAuditQuery,
  siteClientEventsQuery,
  siteClientsQuery,
} from './siteSchemas'

/**
 * The page size of the operator's lists is one bound (HTTP-L-09): the three keyset pages are one
 * shape under three names, and the audit log's limit is the same number, not a second spelling of
 * it. `MAX_SITE_PAGE_SIZE` is the use case's own bound (`parseSitePageLimit` refuses beyond it),
 * so what the boundary accepts is what the use case would not have to refuse.
 */
describe('the operator’s page queries', () => {
  const pages = [
    ['clients', siteClientsQuery],
    ['accounts', siteAccountsQuery],
    ['a client’s events', siteClientEventsQuery],
  ] as const

  it.each(pages)('accepts a limit of exactly the page size on %s', (_name, schema) => {
    expect(schema.safeParse({ limit: String(MAX_SITE_PAGE_SIZE) }).success).toBe(true)
  })

  it.each(pages)('refuses a limit of one more than the page size on %s', (_name, schema) => {
    expect(schema.safeParse({ limit: String(MAX_SITE_PAGE_SIZE + 1) }).success).toBe(false)
  })

  it.each(pages)('refuses a limit of zero on %s', (_name, schema) => {
    expect(schema.safeParse({ limit: '0' }).success).toBe(false)
  })

  it.each(pages)('refuses a key that is not part of a page on %s', (_name, schema) => {
    expect(schema.safeParse({ offset: '10' }).success).toBe(false)
  })

  it('gives the audit log the same bound on its limit', () => {
    expect(siteAuditQuery.safeParse({ limit: String(MAX_SITE_PAGE_SIZE) }).success).toBe(true)
    expect(siteAuditQuery.safeParse({ limit: String(MAX_SITE_PAGE_SIZE + 1) }).success).toBe(false)
  })
})
