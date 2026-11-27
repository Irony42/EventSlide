import { describe, expect, it } from 'vitest'
import { MAX_SITE_PAGE_SIZE } from '../../../application/usecases/site/sitePageLimit'
import {
  hostNoticeBody,
  offboardClientBody,
  operatorActBody,
  operatorTakedownBody,
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

describe('the notice to the host on an operator act (spec 32, A4)', () => {
  it('takes the audit reason with the two optional fields on a take-down, and nothing else', () => {
    expect(operatorTakedownBody.safeParse({ reason: 'r' }).success).toBe(true)
    expect(
      operatorTakedownBody.safeParse({ reason: 'r', notifyHost: false, hostReason: 'x' }).success,
    ).toBe(true)
    expect(operatorTakedownBody.safeParse({ reason: 'r', extra: 1 }).success).toBe(false)
    expect(operatorTakedownBody.safeParse({ notifyHost: true }).success).toBe(false)
    expect(operatorTakedownBody.safeParse({ reason: 'r', notifyHost: 'yes' }).success).toBe(false)
  })

  it('leaves a restore with the audit reason alone: it tells nobody', () => {
    expect(operatorActBody.safeParse({ reason: 'r', notifyHost: true }).success).toBe(false)
  })

  it('takes an empty body or the two fields on a suspension, a resumption, and the two fields beside the days on an offboarding', () => {
    expect(hostNoticeBody.safeParse({}).success).toBe(true)
    expect(hostNoticeBody.safeParse({ hostReason: 'x' }).success).toBe(true)
    expect(hostNoticeBody.safeParse({ graceDays: 3 }).success).toBe(false)
    expect(offboardClientBody.safeParse({ graceDays: 30, notifyHost: false }).success).toBe(true)
    expect(offboardClientBody.safeParse({ notifyHost: false }).success).toBe(false)
  })

  it('bounds what a request may carry as the reason for the host, leaving the 500-character rule to the domain', () => {
    expect(hostNoticeBody.safeParse({ hostReason: 'a'.repeat(4000) }).success).toBe(true)
    expect(hostNoticeBody.safeParse({ hostReason: 'a'.repeat(4001) }).success).toBe(false)
  })
})
