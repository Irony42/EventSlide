import type { DomainError } from '../../../domain/shared/errors'
import type { ClientId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { SiteClientPage, SiteOverview } from '../../ports/siteOverview'
import { parseSitePageLimit } from './sitePageLimit'

/**
 * Every client of the box with its ceilings and what it is using (`GET /api/site/clients`;
 * G2-14 / P3-13), a page at a time, newest first.
 *
 * **The read model is the whole of what this can say.** It is given `SiteOverview` and nothing
 * else, so a client's events, its photographs and its members are not something it could hand
 * out if it tried; what an operator may see of the box is decided once, in
 * `domain/site/siteOverviewRows.ts`. Who may call it is the HTTP layer's (`requireOperator`).
 */

export interface ListSiteClientsInput {
  /** The `next` of the previous page; absent for the first. */
  readonly after?: ClientId
  readonly limit?: number
}

export interface ListSiteClientsDeps {
  readonly overview: Pick<SiteOverview, 'listClients'>
}

export type ListSiteClients = (
  input: ListSiteClientsInput,
) => Promise<Result<SiteClientPage, DomainError>>

export const makeListSiteClients =
  ({ overview }: ListSiteClientsDeps): ListSiteClients =>
  async ({ after, limit }) => {
    const size = parseSitePageLimit(limit)
    if (!size.ok) return size

    return ok(
      await overview.listClients({
        ...(after === undefined ? {} : { after }),
        limit: size.value,
      }),
    )
  }
