import type { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { SiteAccountPage, SiteOverview } from '../../ports/siteOverview'
import { parseSitePageLimit } from './sitePageLimit'

/**
 * Every account of the box: how it is recognised (its address), whether it may sign in, which
 * clients it belongs to and whether it owns an event (`GET /api/site/accounts`; G2-14 / P3-13).
 * **Never its hash and never its display name**: `SiteAccountRow` has no field for either.
 */

export interface ListSiteAccountsInput {
  /** The `next` of the previous page; absent for the first. */
  readonly after?: UserId
  readonly limit?: number
}

export interface ListSiteAccountsDeps {
  readonly overview: Pick<SiteOverview, 'listAccounts'>
}

export type ListSiteAccounts = (
  input: ListSiteAccountsInput,
) => Promise<Result<SiteAccountPage, DomainError>>

export const makeListSiteAccounts =
  ({ overview }: ListSiteAccountsDeps): ListSiteAccounts =>
  async ({ after, limit }) => {
    const size = parseSitePageLimit(limit)
    if (!size.ok) return size

    return ok(
      await overview.listAccounts({
        ...(after === undefined ? {} : { after }),
        limit: size.value,
      }),
    )
  }
