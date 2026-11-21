import { Router, type Request } from 'express'
import { DomainError } from '../../../domain/shared/errors'
import { asyncHandler } from '../middleware/asyncHandler'
import { guestInviteLimiter } from '../middleware/rateLimit'
import { toGuestInvitePageDto } from '../presenters/presenters'
import { sendError, sendJson, sendResult } from '../presenters/send'
import { serveRanged } from '../presenters/serveRanged'
import { guestInviteTokenParams } from '../schemas/requestSchemas'
import type { HttpUseCases, RouteDeps } from '../useCases'

/**
 * The invitation a guest opens (spec 29): `GET /api/i/:token`, and the host's logo under it.
 *
 * **No credential, no cookie, no body**: a guest opens a link in a message. What the page says,
 * and when, is `viewGuestInvite`'s; this module parses the token, calls one use case and presents.
 *
 * **One refusal for everything**: `404 guestInvite.notAvailable` for a token that is unknown,
 * malformed or too long to be one, switched off, or whose event is archived, taken down or
 * frozen: the response cannot tell a stranger which. Every answer carries `no-referrer`,
 * `noindex` and `no-store`, mounted by `server.ts` ahead of the body parser as the gallery's are,
 * since the token is in the path.
 *
 * One limiter for the page and the logo, per client address (`GUEST_INVITE_RATE_LIMIT_PER_MINUTE`).
 */

export interface GuestInvitePublicRouteDeps extends Omit<RouteDeps, 'usecases'> {
  readonly usecases: Pick<HttpUseCases, 'viewGuestInvite' | 'getGuestInviteLogoMedia'>
}

/** A token that is not token-shaped is answered exactly as a dead one. */
const tokenOf = (req: Request): string | null => {
  const parsed = guestInviteTokenParams.safeParse(req.params)
  return parsed.success ? parsed.data.token : null
}

export const guestInvitePublicRoutes = ({ deps, usecases }: GuestInvitePublicRouteDeps): Router => {
  const router = Router()
  const limit = guestInviteLimiter(deps.config.rateLimits.guestInvitePerMinute)
  const notAvailable = (): DomainError => DomainError.notFound('guestInvite.notAvailable')

  router.get(
    '/i/:token',
    limit,
    asyncHandler(async (req, res) => {
      const token = tokenOf(req)
      if (token === null) return sendError(res, notAvailable())

      const result = await usecases.viewGuestInvite({ token })

      sendResult(res, result, (response, view) =>
        sendJson(response, toGuestInvitePageDto(view, token)),
      )
    }),
  )

  router.get(
    '/i/:token/logo',
    limit,
    asyncHandler(async (req, res) => {
      const token = tokenOf(req)
      if (token === null) return sendError(res, notAvailable())

      const media = await usecases.getGuestInviteLogoMedia({ token })
      if (!media.ok) return sendError(res, media.error)

      res.setHeader('X-Content-Type-Options', 'nosniff')
      // Not cached by a shared cache and not for a year: the address is the token's, and what it
      // serves stops the moment the page does. The name of the bytes changes the ETag.
      return serveRanged(req, res, media.value, {
        contentType: media.value.contentType,
        cacheControl: 'no-store',
        contentDisposition: 'inline',
        etag: `"${media.value.contentHash.value}-logo"`,
        failureMessage: 'guest invitation logo failed mid-stream',
      })
    }),
  )

  return router
}
