import { useCallback } from 'react'
import { useApi } from '../../../app/useApi'
import type { SiteClientDto } from '../../../lib/api/dto'
import { useLoader } from '../../admin/hooks/useLoader'

const PAGE = 200

export interface SiteClientState {
  /** The client, or `null` while it is read **and** for an id that names nobody (`found`). */
  readonly client: SiteClientDto | null
  /** The listing was read to its end and the id is not in it. */
  readonly missing: boolean
  readonly loading: boolean
  readonly error: string | null
  readonly reload: () => void
}

/**
 * One client's row, for the page that opens it.
 *
 * **There is no route that reads one client** (`GET /api/site/clients` is the listing, and
 * `GET /api/site/clients/:clientId/events` answers `404` for a stranger but says nothing of the
 * client itself), so this walks the listing, two hundred rows a page, until it meets the id. A box
 * run for a handful of clients reads one page; a box with thousands would want the route, and
 * that is a change to the operator's API and not to this screen.
 *
 * A listing read to its end without the id is `missing`: the same answer for a client that never
 * existed and one that was deleted, which is all the operator can be told.
 */
export const useSiteClient = (clientId: string): SiteClientState => {
  const api = useApi()
  const load = useCallback(
    async (signal: AbortSignal): Promise<SiteClientDto | null> => {
      let after: string | undefined
      for (;;) {
        const page = await api.siteClients(
          { ...(after === undefined ? {} : { after }), limit: PAGE },
          signal,
        )
        const found = page.items.find((client) => client.id === clientId)
        if (found !== undefined) return found
        if (page.next === null) return null
        after = page.next
      }
    },
    [api, clientId],
  )
  const { data, loading, error, reload } = useLoader(load)

  return {
    client: data,
    missing: !loading && error === null && data === null,
    loading,
    error,
    reload,
  }
}
