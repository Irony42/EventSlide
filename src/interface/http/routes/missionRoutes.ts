import { Router } from 'express'
import { asMissionId } from '../../../domain/shared/ids'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireRole } from '../middleware/authz'
import { toMissionDto } from '../presenters/presenters'
import { sendJson, sendNoContent, sendResult } from '../presenters/send'
import { missionBody, missionParams } from '../schemas/requestSchemas'
import { hostScope } from './eventRoutes'
import type { MissionDto, MissionListResponseDto } from '../presenters/dto'
import type { HttpUseCases, RouteDeps } from '../useCases'

/**
 * The host's mission list (roadmap §2.1): the short set of prompts a room is asked for.
 *
 * ## Two roles, not one, and the line between them is the point
 *
 * **Reading is a moderator's; writing is the owner's.** A moderator standing at a laptop
 * mid-evening is exactly the person who wants to know that nobody has photographed the
 * cake yet, and telling them costs the event nothing. Writing the sentence that two
 * hundred people read off a projector is a different grant — it is what the event *is*,
 * like its name and its settings — and `updateEventSettings` already draws that line in
 * the same words.
 *
 * ## `PATCH` that is not partial
 *
 * Both fields every time, which is the shape `PATCH /events/:slug/schedule` already has
 * and made the same call for: a prompt and who it is asked of are one decision made on
 * one row of one form, and a partial update would let a scope be persisted beside a
 * prompt the domain refused. The verb matches the rest of this API rather than the strict
 * reading of the two RFCs; `eventScheduleBody` is the precedent and the neighbour.
 *
 * ## Why editing exists at all
 *
 * `DELETE` unfiles every photograph that named the mission — deliberately, and never
 * deleting one. So a host fixing a typo by deleting and re-adding would silently take
 * four photographs out of the count they were already in, which is exactly what the
 * edit route is here to prevent.
 */

/**
 * The slice of {@link RouteDeps} this router needs.
 *
 * A narrow view for the same reason `publicRoutes` takes one: naming the four use cases
 * it calls means the contract test builds exactly those out of fakes rather than a
 * thirty-key bag of stubs that proves nothing. The container's full `RouteDeps`
 * satisfies it structurally, so `server.ts` is unchanged.
 */
export interface MissionRouteDeps extends Omit<RouteDeps, 'usecases'> {
  readonly usecases: Pick<
    HttpUseCases,
    'listMissions' | 'createMission' | 'updateMission' | 'deleteMission'
  >
}

export const missionRoutes = ({ deps, usecases }: MissionRouteDeps): Router => {
  const router = Router()

  /**
   * `GET /events/:eventSlug/missions` — the list, with how the room is answering it.
   *
   * No paging and no cursor, and that is a property of the data rather than an omission:
   * `MAX_MISSIONS_PER_EVENT` is twelve, so the whole list is the page.
   */
  router.get(
    '/events/:eventSlug/missions',
    requireRole('moderator', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScope(req.context)

      const result = await usecases.listMissions({
        // The event `requireRole` already resolved, never an id re-derived from the path.
        eventId: scope.event.id,
        actorId: scope.user.userId,
      })

      sendResult(res, result, (response, items) => {
        const dto: MissionListResponseDto = { items: items.map(toMissionDto) }
        sendJson(response, dto)
      })
    }),
  )

  router.post(
    '/events/:eventSlug/missions',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScope(req.context)
      const body = missionBody.parse(req.body)

      const result = await usecases.createMission({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        prompt: body.prompt,
        scope: body.scope,
      })

      sendResult(res, result, (response, mission) => {
        // Freshly created, so nothing can have answered it yet — presented through the
        // same shape as the list rather than a second one, so a console that renders a
        // row has one renderer.
        const dto: MissionDto = toMissionDto({
          mission,
          progress: { publishedPhotos: 0, completedByGuests: 0 },
          achieved: false,
        })
        sendJson(response, dto, 201)
      })
    }),
  )

  router.patch(
    '/events/:eventSlug/missions/:missionId',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScope(req.context)
      const params = missionParams.parse(req.params)
      const body = missionBody.parse(req.body)

      const result = await usecases.updateMission({
        eventId: scope.event.id,
        missionId: asMissionId(params.missionId),
        actorId: scope.user.userId,
        prompt: body.prompt,
        scope: body.scope,
      })

      /**
       * `204`, where the create answers `201` with the row.
       *
       * The asymmetry is deliberate and it is about honesty rather than economy. A
       * freshly created mission has no photographs by construction, so `{achieved:
       * false, publishedPhotos: 0}` on that response is a fact. An **edited** one may
       * have twelve, and the use case returns the `Mission` alone — it changes a prompt
       * and a scope and touches no photograph, so it has no reason to count them. Padding
       * this response with zeros to keep the two shapes matching would put a number on
       * the wire that is simply false, and a console rendering the answer would show a
       * ticked mission as open until something else refetched.
       *
       * So it returns nothing, and the console refetches the list — which it is doing
       * anyway, on the `mission.changed` signal this edit just published.
       */
      sendResult(res, result, sendNoContent)
    }),
  )

  router.delete(
    '/events/:eventSlug/missions/:missionId',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScope(req.context)
      const params = missionParams.parse(req.params)

      const result = await usecases.deleteMission({
        eventId: scope.event.id,
        missionId: asMissionId(params.missionId),
        actorId: scope.user.userId,
      })

      sendResult(res, result, sendNoContent)
    }),
  )

  return router
}
