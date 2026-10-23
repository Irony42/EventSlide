import type { DomainError } from '../../../domain/shared/errors'
import type { ClientId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { AuditLog, AuditPage } from '../../ports/auditLog'
import { parseSitePageLimit } from './sitePageLimit'

/**
 * The operator's view of the audit log (`GET /api/site/audit`; G2-14 / P3-13): every line on the
 * box, newest first, or one client's when `clientId` is given.
 *
 * It is **the** unfiltered read of the log, which is why it takes `Pick<AuditLog, 'list'>` and no
 * more: it can no more prune the log than the client's own view can. The client's view
 * (`listClientAudit`) is the other way round and cannot omit the filter.
 *
 * The page is the port's, **as it is**. What an operator sees of a record, and what a client is
 * not shown of the same one, are two presenters' decisions, written field by field.
 */

export interface ListSiteAuditInput {
  /** Only this client's lines. Absent: every line on the box. */
  readonly clientId?: ClientId
  /** The `next` of the previous page. */
  readonly before?: number
  readonly limit?: number
}

export interface ListSiteAuditDeps {
  readonly audit: Pick<AuditLog, 'list'>
}

export type ListSiteAudit = (input: ListSiteAuditInput) => Promise<Result<AuditPage, DomainError>>

export const makeListSiteAudit =
  ({ audit }: ListSiteAuditDeps): ListSiteAudit =>
  async ({ clientId, before, limit }) => {
    const size = parseSitePageLimit(limit)
    if (!size.ok) return size

    return ok(
      await audit.list({
        limit: size.value,
        ...(clientId === undefined ? {} : { clientId }),
        ...(before === undefined ? {} : { before }),
      }),
    )
  }
