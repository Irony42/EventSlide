import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireUser } from '../middleware/authz'
import { userOf } from '../middleware/scope'
import { toMyLimitsDto } from '../presenters/presenters'
import { sendJson, sendResult } from '../presenters/send'
import { myLimitsQuery } from '../schemas/clientSchemas'
import type { HttpUseCases, RouteDeps } from '../useCases'

/**
 * What the signed-in account reads about itself on a box that runs clients, `/api/me/*`
 * (docs/ROADMAP.md §10.9; G2-16 / P3-17), mounted only with `SITE_ADMIN=on`: with it off there
 * is no client space and every path here answers as an unknown route does.
 *
 * It carries one route, `GET /api/me/limits`. **Whose limits they are is never the request's to
 * say**: the route takes no parameter (a strict, empty query), and the use case reads the
 * caller's own memberships. An account in no client is answered `{ "clients": [] }`, which is
 * what a box's operator and a client-less account both get.
 *
 * Like `/api/client`, there is no `requireRole` here, because there is no event.
 */

export interface MeRouteDeps extends Omit<RouteDeps, 'usecases'> {
  readonly usecases: Pick<HttpUseCases, 'getClientLimits'>
}

export const meRoutes = ({ deps, usecases }: MeRouteDeps): Router => {
  const router = Router()

  router.get(
    '/me/limits',
    requireUser(deps),
    asyncHandler(async (req, res) => {
      const user = userOf(req)
      myLimitsQuery.parse(req.query)

      const result = await usecases.getClientLimits({ userId: user.userId })

      // Personal to the caller and moving as they upload: never kept by a cache.
      res.setHeader('Cache-Control', 'no-store')
      sendResult(res, result, (response, limits) => sendJson(response, toMyLimitsDto(limits)))
    }),
  )

  return router
}
