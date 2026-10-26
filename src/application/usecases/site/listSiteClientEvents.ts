import { DomainError } from '../../../domain/shared/errors'
import type { ClientId, EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { SiteEventPage, SiteOverview } from '../../ports/siteOverview'
import { parseSitePageLimit } from './sitePageLimit'

/**
 * One client's events, as shapes and sizes and nothing else
 * (`GET /api/site/clients/:clientId/events`; G2-14 / P3-13): an id, a status, dates, a quota and
 * what is used. **Never** an event's name, slug or join code, a photograph, a guest or a
 * caption: `SiteEventRow` has no field for any of them, which is why the operator can be shown
 * this and not be shown a wedding.
 *
 * `client.notFound` for a client that does not exist, which the port reports as `null` and which
 * is told apart from a client with no event (an empty page). A cursor naming another client's
 * event is an empty page, so a cursor tells the caller nothing about an event it did not ask about.
 */

export interface ListSiteClientEventsInput {
  readonly clientId: ClientId
  /** The `next` of the previous page; absent for the first. */
  readonly after?: EventId
  readonly limit?: number
}

export interface ListSiteClientEventsDeps {
  readonly overview: Pick<SiteOverview, 'clientEvents'>
}

export type ListSiteClientEvents = (
  input: ListSiteClientEventsInput,
) => Promise<Result<SiteEventPage, DomainError>>

export const makeListSiteClientEvents =
  ({ overview }: ListSiteClientEventsDeps): ListSiteClientEvents =>
  async ({ clientId, after, limit }) => {
    const size = parseSitePageLimit(limit)
    if (!size.ok) return size

    const page = await overview.clientEvents(clientId, {
      ...(after === undefined ? {} : { after }),
      limit: size.value,
    })
    return page === null ? err(DomainError.notFound('client.notFound')) : ok(page)
  }
