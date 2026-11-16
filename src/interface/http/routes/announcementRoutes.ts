import { Router } from 'express'
import { asAnnouncementId } from '../../../domain/shared/ids'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireRole } from '../middleware/authz'
import {
  ANNOUNCEMENT_WRITES_PER_ACCOUNT_PER_MINUTE,
  announcementWriteLimiter,
} from '../middleware/rateLimit'
import { hostScopeOf } from '../middleware/scope'
import { toAnnouncementListResponseDto, toAnnouncementResponseDto } from '../presenters/presenters'
import { sendJson, sendNoContent, sendResult } from '../presenters/send'
import {
  announcementCreateBody,
  announcementParams,
  announcementPatchBody,
  eventSlugParams,
} from '../schemas/requestSchemas'
import type { HttpUseCases, RouteDeps } from '../useCases'

/**
 * The scheduled announcements a host puts on the wall (spec 21): "Gâteau à 22 h", a card in the
 * middle of the screen after an optional countdown, or a discreet text over the photographs.
 *
 * **A moderator's, not the owner's**, like the challenge: the person at the evening with a phone
 * is usually the moderator. A guest's token never reaches these routes (`requireRole` reads a
 * session), so nobody who opens the wall's URL can write one.
 *
 * Four writes, so the CSRF gate and the no-store default apply as to every host route, plus an
 * **account-keyed write limiter** (a constant: the feature adds no environment variable). Bodies
 * are strict, every bound is the domain's and answers its own `400 announcement.*Invalid` with
 * the limits in the body, and an announcement is resolved **inside the event** the path names
 * (`404 announcement.notFound` for any other).
 *
 * The wall reads the announcements inside its own response (`GET /wall`, only what its window
 * allows); the console, which has no such response, reads them here.
 */

export interface AnnouncementRouteDeps extends Omit<RouteDeps, 'usecases'> {
  readonly usecases: Pick<
    HttpUseCases,
    | 'listAnnouncements'
    | 'createAnnouncement'
    | 'updateAnnouncement'
    | 'launchAnnouncement'
    | 'deleteAnnouncement'
  >
}

export const announcementRoutes = ({ deps, usecases }: AnnouncementRouteDeps): Router => {
  const router = Router()
  const writeLimiter = announcementWriteLimiter(ANNOUNCEMENT_WRITES_PER_ACCOUNT_PER_MINUTE)

  /** `GET /events/:eventSlug/announcements`: every announcement, with its state at the server clock. */
  router.get(
    '/events/:eventSlug/announcements',
    requireRole('moderator', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      eventSlugParams.parse(req.params)

      const result = await usecases.listAnnouncements({
        eventId: scope.event.id,
        actorId: scope.user.userId,
      })

      sendResult(res, result, (response, list) =>
        sendJson(response, toAnnouncementListResponseDto(list)),
      )
    }),
  )

  /** Schedules one, or launches it when no `at` is sent. */
  router.post(
    '/events/:eventSlug/announcements',
    requireRole('moderator', deps),
    writeLimiter,
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      const body = announcementCreateBody.parse(req.body)

      const result = await usecases.createAnnouncement({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        text: body.text,
        ...(body.kind === undefined ? {} : { kind: body.kind }),
        ...(body.at === undefined ? {} : { at: body.at }),
        ...(body.durationSeconds === undefined ? {} : { durationSeconds: body.durationSeconds }),
        ...(body.countdownSeconds === undefined ? {} : { countdownSeconds: body.countdownSeconds }),
      })

      sendResult(res, result, (response, created) =>
        sendJson(response, toAnnouncementResponseDto(created), 201),
      )
    }),
  )

  router.patch(
    '/events/:eventSlug/announcements/:announcementId',
    requireRole('moderator', deps),
    writeLimiter,
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      const params = announcementParams.parse(req.params)
      const body = announcementPatchBody.parse(req.body)

      const result = await usecases.updateAnnouncement({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        announcementId: asAnnouncementId(params.announcementId),
        ...(body.text === undefined ? {} : { text: body.text }),
        ...(body.kind === undefined ? {} : { kind: body.kind }),
        ...(body.at === undefined ? {} : { at: body.at }),
        ...(body.durationSeconds === undefined ? {} : { durationSeconds: body.durationSeconds }),
        ...(body.countdownSeconds === undefined ? {} : { countdownSeconds: body.countdownSeconds }),
      })

      sendResult(res, result, (response, updated) =>
        sendJson(response, toAnnouncementResponseDto(updated)),
      )
    }),
  )

  /** "Lancer maintenant" and "Relancer": no body, the announcement starts at the server clock. */
  router.post(
    '/events/:eventSlug/announcements/:announcementId/launch',
    requireRole('moderator', deps),
    writeLimiter,
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      const params = announcementParams.parse(req.params)

      const result = await usecases.launchAnnouncement({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        announcementId: asAnnouncementId(params.announcementId),
      })

      sendResult(res, result, (response, launched) =>
        sendJson(response, toAnnouncementResponseDto(launched)),
      )
    }),
  )

  router.delete(
    '/events/:eventSlug/announcements/:announcementId',
    requireRole('moderator', deps),
    writeLimiter,
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      const params = announcementParams.parse(req.params)

      const result = await usecases.deleteAnnouncement({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        announcementId: asAnnouncementId(params.announcementId),
      })

      sendResult(res, result, sendNoContent)
    }),
  )

  return router
}
