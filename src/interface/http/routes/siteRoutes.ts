import { Router } from 'express'
import { requireOperator, requireSecondFactor } from '../middleware/authz'
import { toClientDefaultsDto } from '../presenters/clientDefaultsPresenter'
import type { RouteDeps } from '../useCases'

/**
 * The operator's own namespace: `/api/site/*` (docs/ROADMAP.md §10.9).
 *
 * **The gate belongs to the namespace, not to a route.** `requireOperator` is applied
 * with `router.use`, ahead of anything this router will ever carry, so a route added here
 * is behind it the day it is written, whether or not its author remembered the gate
 * exists. The alternative — one `requireOperator` per route, the way `requireRole` is
 * written on the event routes — is a rule every future author has to restate, and the
 * route that forgets it is the one that hands a client list to anybody signed in.
 *
 * It carries one route so far, `GET /client-defaults` (G2-18). The surfaces of §10.2 to §10.8
 * arrive with their own items, each one registered below the gate. An operator whose request
 * matches none of them falls through: `requireOperator` calls `next()`, this router has
 * nothing to match, and `buildServer`'s `apiNotFound` answers `404 route.notFound` exactly as it
 * would anywhere else under `/api`.
 *
 * What this router may **not** do is reach into anybody's event. `requireOperator` grants
 * the box, never an evening — see `middleware/authz.ts` — and a handler here that read a
 * photograph or a moderation queue would be §10.6's support access without its time-box,
 * its announcement or its audit trail.
 *
 * Whether the router exists at all is `buildServer`'s decision, from `SITE_ADMIN`; nothing
 * in here reads the switch, because nothing in here needs to.
 */

export type SiteRouteDeps = Pick<RouteDeps, 'deps'>

export const siteRoutes = ({ deps }: SiteRouteDeps): Router => {
  const router = Router()

  // First, and for every method and every path under the mount point. Nothing may be
  // registered above this line.
  router.use(requireOperator(deps))

  // Second, and only for an operator: on a box with `REQUIRE_OPERATOR_2FA` a session that has not
  // passed the second factor reaches nothing below (G2-13 / P3-15). After `requireOperator` so a
  // stranger is told `auth.forbidden` and nothing about second factors. Off, it does nothing.
  router.use(requireSecondFactor(deps))

  /**
   * The ceilings a new client starts with (`NEW_CLIENT_*`, G2-18), for the console to pre-fill
   * the form that provisions one. **Configuration, not content**: it names no client, no event
   * and no account, and reads nothing from storage. `no-store`, because it describes the
   * instance's policy to whoever is signed in and a shared cache has no business holding it.
   */
  router.get('/client-defaults', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json(toClientDefaultsDto(deps.config.newClientCeilings))
  })

  return router
}
