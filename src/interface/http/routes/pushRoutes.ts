import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireRole, requireUser } from '../middleware/authz'
import { hostScopeOf } from '../middleware/scope'
import type { PushKeyResponseDto } from '../presenters/dto'
import { sendJson, sendResult, sendResultNoContent } from '../presenters/send'
import { eventSlugParams, pushSubscribeBody, pushUnsubscribeBody } from '../schemas/requestSchemas'
import type { HttpUseCases, RouteDeps } from '../useCases'

/**
 * The host's browser notifications (spec 30, lot 4, Web Push).
 *
 * - `GET /push/key`: the box's public VAPID key, for a signed-in account, or `404 push.disabled`
 *   while the box has no keys. A public key is not a secret, but nothing is gained by telling
 *   a stranger that this box can push.
 * - `POST /events/:eventSlug/push-subscription` (the event's owner) stores **this browser's**
 *   subscription for the event; `DELETE` removes it (any member: someone demoted may still switch
 *   it off). **`204`, and nothing about the subscription is ever sent back**: the endpoint is a
 *   capability URL. Writes are CSRF-gated like every write of the instance; the bodies are strict and
 *   every value is judged by the domain (the endpoint by the push-service allowlist).
 */

export interface PushRouteDeps extends Omit<RouteDeps, 'usecases'> {
  readonly usecases: Pick<HttpUseCases, 'getPushKey' | 'subscribePush' | 'unsubscribePush'>
}

export const pushRoutes = ({ deps, usecases }: PushRouteDeps): Router => {
  const router = Router()

  router.get(
    '/push/key',
    requireUser(deps),
    asyncHandler(async (_req, res) => {
      res.setHeader('Cache-Control', 'no-store')
      const result = await usecases.getPushKey()
      sendResult(res, result, (response, publicKey) =>
        sendJson<PushKeyResponseDto>(response, { publicKey }),
      )
    }),
  )

  router.post(
    '/events/:eventSlug/push-subscription',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      eventSlugParams.parse(req.params)
      const body = pushSubscribeBody.parse(req.body)

      const result = await usecases.subscribePush({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        endpoint: body.endpoint,
        keys: body.keys,
      })

      res.setHeader('Cache-Control', 'no-store')
      sendResultNoContent(res, result)
    }),
  )

  router.delete(
    '/events/:eventSlug/push-subscription',
    requireRole('moderator', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      eventSlugParams.parse(req.params)
      const body = pushUnsubscribeBody.parse(req.body)

      const result = await usecases.unsubscribePush({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        endpoint: body.endpoint,
      })

      res.setHeader('Cache-Control', 'no-store')
      sendResultNoContent(res, result)
    }),
  )

  return router
}
