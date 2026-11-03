import { Router } from 'express'
import { asMissionId } from '../../../domain/shared/ids'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireRole } from '../middleware/authz'
import { hostScopeOf } from '../middleware/scope'
import { toStartedChallengeDto } from '../presenters/presenters'
import { sendJson, sendNoContent, sendResult } from '../presenters/send'
import { challengeBody, challengeParams } from '../schemas/requestSchemas'
import type { HttpUseCases, RouteDeps } from '../useCases'

/**
 * The timed photo challenge a host launches on the wall (spec 10).
 *
 * **A moderator's, not the owner's.** The person at the evening with a laptop is usually the
 * moderator, and a challenge writes no sentence: it only says when a mission the owner already
 * wrote is asked of the room. A guest's token never reaches these routes (`requireRole` reads a
 * session), so nobody who opens the wall's URL can start or stop anything.
 *
 * Both routes are writes, so the CSRF gate and the no-store default apply to them like to every
 * other host route; the body is strict, and the duration's bounds are the domain's.
 *
 * The reads are not here: the wall and the phones read the running challenge inside their own
 * responses (`GET /wall`, `GET /missions/mine`).
 */

export interface ChallengeRouteDeps extends Omit<RouteDeps, 'usecases'> {
  readonly usecases: Pick<HttpUseCases, 'startChallenge' | 'stopChallenge'>
}

export const challengeRoutes = ({ deps, usecases }: ChallengeRouteDeps): Router => {
  const router = Router()

  router.post(
    '/events/:eventSlug/challenge',
    requireRole('moderator', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      const body = challengeBody.parse(req.body)

      const result = await usecases.startChallenge({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        missionId: asMissionId(body.missionId),
        durationSeconds: body.durationSeconds,
      })

      sendResult(res, result, (response, challenge) =>
        sendJson(response, toStartedChallengeDto(challenge), 201),
      )
    }),
  )

  /** Idempotent: with nothing running it answers `204` all the same. */
  router.delete(
    '/events/:eventSlug/challenge',
    requireRole('moderator', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      challengeParams.parse(req.params)

      const result = await usecases.stopChallenge({
        eventId: scope.event.id,
        actorId: scope.user.userId,
      })

      sendResult(res, result, sendNoContent)
    }),
  )

  return router
}
