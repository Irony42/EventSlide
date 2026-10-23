import { useCallback } from 'react'
import { useAbout } from '../../../app/useAbout'
import { useApi } from '../../../app/useApi'
import type { ClientLimitsDto } from '../../../lib/api/dto'
import { contactActionOf, type ContactAction } from '../ceilingLevels'
import { useLoader } from './useLoader'

export interface ClientLimits {
  /** The caller's own clients, and none on a box with no client space or for an account in none. */
  readonly clients: readonly ClientLimitsDto[]
  /** Where "contact your operator" leads, or `null` when the box published no address. */
  readonly contact: ContactAction | null
  readonly loading: boolean
}

/**
 * What the dashboard and the new-event form know about the signed-in account's clients
 * (`GET /api/me/limits`; G2-16 / P3-17).
 *
 * **It asks only a box that has a client space.** `/api/me/limits` is an unknown route when
 * `SITE_ADMIN=off`, and the SPA reads `features.siteAdmin` from `/api/about` instead of probing a
 * path that answers one way in one mode and another in the other: with the flag false this
 * resolves to "no client" without sending a request, which is what keeps a solo box exactly as
 * it was.
 *
 * **A failed read is no limits, not a broken page.** The banner is a warning that comes before
 * the server's refusal and the refusal is the enforcement, so a host whose limits could not be
 * read still creates and moderates, and is told by the server if a ceiling is in the way.
 */
export const useClientLimits = (): ClientLimits => {
  const api = useApi()
  const about = useAbout()
  const siteAdmin = about.features.siteAdmin

  const load = useCallback(
    async (signal: AbortSignal): Promise<readonly ClientLimitsDto[]> =>
      siteAdmin ? (await api.myLimits(signal)).clients : [],
    [api, siteAdmin],
  )
  const { data, loading } = useLoader(load)

  return { clients: data ?? [], contact: contactActionOf(about), loading }
}
