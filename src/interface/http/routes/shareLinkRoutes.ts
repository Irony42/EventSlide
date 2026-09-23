import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireRole } from '../middleware/authz'
import { toShareLinkCreatedDto, toShareLinkDto } from '../presenters/presenters'
import type { ShareLinkResponseDto } from '../presenters/dto'
import { sendJson, sendResult, sendResultNoContent } from '../presenters/send'
import { shareLinkBody } from '../schemas/requestSchemas'
import { hostScope } from './eventRoutes'
import type { HttpUseCases, RouteDeps } from '../useCases'

/**
 * The host's side of the shared gallery (roadmap §4.1): view, make and revoke the one
 * link an event has.
 *
 * **Owner only, on all three.** Publishing the album beyond the room is a decision about
 * the whole event, the same grant as its settings; and the view is owner-only as well, so
 * a moderator is never shown a panel whose every button would come back 403. A stranger
 * gets the 404 `requireRole` gives every non-member, never a 403 that would confirm the
 * event exists.
 *
 * **`Cache-Control: no-store` on both reads.** The create response carries the address —
 * the only time it exists anywhere but in the host's own message — and neither it nor the
 * link's status should be kept by anything between the host and this box.
 */

export interface ShareLinkRouteDeps extends Omit<RouteDeps, 'usecases'> {
  readonly usecases: Pick<HttpUseCases, 'getShareLink' | 'createShareLink' | 'revokeShareLink'>
}

export const shareLinkRoutes = ({ deps, usecases, presenter }: ShareLinkRouteDeps): Router => {
  const router = Router()

  router.get(
    '/events/:eventSlug/share-link',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScope(req.context)

      const result = await usecases.getShareLink({
        eventId: scope.event.id,
        actorId: scope.user.userId,
      })

      sendResult(res, result, (response, view) => {
        const dto: ShareLinkResponseDto = { link: view === null ? null : toShareLinkDto(view) }
        response.setHeader('Cache-Control', 'no-store')
        sendJson(response, dto)
      })
    }),
  )

  router.post(
    '/events/:eventSlug/share-link',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScope(req.context)
      const body = shareLinkBody.parse(req.body)

      const result = await usecases.createShareLink({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        lifetimeDays: body.expiresInDays ?? null,
        password: body.password ?? null,
      })

      sendResult(res, result, (response, created) => {
        response.setHeader('Cache-Control', 'no-store')
        sendJson(response, toShareLinkCreatedDto(created, presenter), 201)
      })
    }),
  )

  router.delete(
    '/events/:eventSlug/share-link',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScope(req.context)

      const result = await usecases.revokeShareLink({
        eventId: scope.event.id,
        actorId: scope.user.userId,
      })

      sendResultNoContent(res, result)
    }),
  )

  return router
}
