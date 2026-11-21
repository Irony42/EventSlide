import { Router } from 'express'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireRole } from '../middleware/authz'
import { hostScopeOf } from '../middleware/scope'
import { toGuestInviteResponseDto } from '../presenters/presenters'
import { sendJson, sendResult } from '../presenters/send'
import { eventSlugParams, guestInviteActBody, guestInviteBody } from '../schemas/requestSchemas'
import type { HttpUseCases, RouteDeps } from '../useCases'

/**
 * The host's side of the guest invitation (spec 29): the faire-part's text, its switch and its link.
 *
 * **The owner's**, like the settings (`requireRole('owner')`; the use cases ask the same right, so a
 * moderator is `403 auth.forbidden` on either layer): the invitation carries the address of the
 * party and a link that outlives the evening. Writes are the CSRF-gated, no-store host routes of
 * every other surface. Bodies are strict, and every bound is the domain's.
 *
 * A read answers `200` with `configured: false` before the host first writes: nothing is created
 * by a GET. The page the **guests** open is a separate, public route (`/api/i/:token`).
 */

export interface GuestInviteRouteDeps extends Omit<RouteDeps, 'usecases'> {
  readonly usecases: Pick<
    HttpUseCases,
    | 'getGuestInvite'
    | 'saveGuestInvite'
    | 'enableGuestInvite'
    | 'disableGuestInvite'
    | 'rotateGuestInviteToken'
  >
}

export const guestInviteRoutes = ({ deps, usecases, presenter }: GuestInviteRouteDeps): Router => {
  const router = Router()

  /** `GET /events/:eventSlug/guest-invite`. */
  router.get(
    '/events/:eventSlug/guest-invite',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      eventSlugParams.parse(req.params)

      const result = await usecases.getGuestInvite({
        eventId: scope.event.id,
        actorId: scope.user.userId,
      })

      sendResult(res, result, (response, view) =>
        sendJson(response, toGuestInviteResponseDto(view, presenter)),
      )
    }),
  )

  /** `PUT /events/:eventSlug/guest-invite`: an absent field is left as it was, `null` clears it. */
  router.put(
    '/events/:eventSlug/guest-invite',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      const body = guestInviteBody.parse(req.body)

      const result = await usecases.saveGuestInvite({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.startsAt === undefined ? {} : { startsAt: body.startsAt }),
        ...(body.endsAt === undefined ? {} : { endsAt: body.endsAt }),
        ...(body.timeZone === undefined ? {} : { timeZone: body.timeZone }),
        ...(body.venueName === undefined ? {} : { venueName: body.venueName }),
        ...(body.address === undefined ? {} : { address: body.address }),
        ...(body.message === undefined ? {} : { message: body.message }),
        ...(body.language === undefined ? {} : { language: body.language }),
      })

      sendResult(res, result, (response, view) =>
        sendJson(response, toGuestInviteResponseDto(view, presenter)),
      )
    }),
  )

  /** "Activer l'invitation". */
  router.post(
    '/events/:eventSlug/guest-invite/enable',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      guestInviteActBody.parse(req.body)

      const result = await usecases.enableGuestInvite({
        eventId: scope.event.id,
        actorId: scope.user.userId,
      })

      sendResult(res, result, (response, view) =>
        sendJson(response, toGuestInviteResponseDto(view, presenter)),
      )
    }),
  )

  /** "Désactiver": the page answers "not available", the text and the link are kept. */
  router.post(
    '/events/:eventSlug/guest-invite/disable',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      guestInviteActBody.parse(req.body)

      const result = await usecases.disableGuestInvite({
        eventId: scope.event.id,
        actorId: scope.user.userId,
      })

      sendResult(res, result, (response, view) =>
        sendJson(response, toGuestInviteResponseDto(view, presenter)),
      )
    }),
  )

  /** "Changer le lien": the old link, and every QR printed with it, stops at once. */
  router.post(
    '/events/:eventSlug/guest-invite/rotate',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      guestInviteActBody.parse(req.body)

      const result = await usecases.rotateGuestInviteToken({
        eventId: scope.event.id,
        actorId: scope.user.userId,
      })

      sendResult(res, result, (response, view) =>
        sendJson(response, toGuestInviteResponseDto(view, presenter)),
      )
    }),
  )

  return router
}
