import { Router, type Request, type RequestHandler } from 'express'
import { DomainError } from '../../../domain/shared/errors'
import { asyncHandler } from '../middleware/asyncHandler'
import { toGuestOwnRsvpResponseDto, toGuestRsvpCreatedDto } from '../presenters/rsvpPresenters'
import { sendError, sendJson, sendResult, sendResultNoContent } from '../presenters/send'
import {
  guestInviteTokenParams,
  guestRsvpBody,
  guestRsvpCreateBody,
} from '../schemas/requestSchemas'
import type { HttpUseCases, RouteDeps } from '../useCases'

/**
 * The guests' replies, the guest's side (spec 30): answer on the invitation's page, read, change and
 * delete one's own reply. **The first public write nobody is signed in for**, so every guard is
 * spelled out:
 *
 * - **no credential but the link**: the invitation's token in the path (as `GET /api/i/:token`),
 *   and, for the reply itself, the token the guest was given **in the `X-Rsvp-Token` header**, never
 *   in a path or a query (those reach access logs). A token valid for another event is the same
 *   `404 rsvp.notFound` as an unknown one;
 * - **8 KB of JSON** at most (\`server.ts\` mounts that parser on \`/api/i\` ahead of the global one:
 *   \`413\` beyond), and a **strict** body: no source, no household, no token field;
 * - **CSRF** like every write of the instance (\`requireCsrfToken\`, which the page's client already
 *   satisfies); the cookie identifies nobody, the limiter and the ceiling are what bound a script;
 * - **a write limiter per address and per invitation**, built once by \`server.ts\` (POST, PUT and
 *   DELETE share it); reads stay under the page's own limiter;
 * - **the one neutral refusal**, \`404 guestInvite.notAvailable\`, for every invitation that cannot be
 *   served, a malformed token included; then the domain's codes (\`409 rsvp.closed|off|tooMany\`,
 *   \`404 rsvp.notFound\`, the \`400 rsvp.*\` of the form);
 * - **a honeypot**, \`website\`, on the creation only.
 *
 * \`Cache-Control: no-store\`, \`no-referrer\` and \`noindex\` are the invitation namespace's
 * (\`galleryHeaders\`, mounted on \`/api/i\`).
 */

export interface GuestRsvpPublicRouteDeps extends Omit<RouteDeps, 'usecases'> {
  readonly usecases: Pick<
    HttpUseCases,
    'submitRsvp' | 'getOwnRsvp' | 'updateOwnRsvp' | 'deleteOwnRsvp'
  >
  /** One instance for the three writes: built once by `server.ts`. */
  readonly rsvpWriteLimiters: readonly RequestHandler[]
  /** The page's own read limiter, **shared** with `guestInvitePublicRoutes`: one budget for a guesser. */
  readonly inviteReadLimiter: RequestHandler
}

const EDIT_TOKEN_HEADER = 'x-rsvp-token'

/** A token that is not token-shaped is answered exactly as a dead one. */
const tokenOf = (req: Request): string | null => {
  const parsed = guestInviteTokenParams.safeParse(req.params)
  return parsed.success ? parsed.data.token : null
}

/** The guest's own token: the one header, read as text if it is text and nothing otherwise. */
const editTokenOf = (req: Request): string | undefined => req.get(EDIT_TOKEN_HEADER)

export const guestRsvpPublicRoutes = ({
  usecases,
  rsvpWriteLimiters,
  inviteReadLimiter: read,
}: GuestRsvpPublicRouteDeps): Router => {
  const router = Router()
  const notAvailable = (): DomainError => DomainError.notFound('guestInvite.notAvailable')

  router.post(
    '/i/:token/rsvp',
    ...rsvpWriteLimiters,
    asyncHandler(async (req, res) => {
      const token = tokenOf(req)
      if (token === null) return sendError(res, notAvailable())
      const body = guestRsvpCreateBody.parse(req.body)

      const result = await usecases.submitRsvp({ token, ...body })

      sendResult(res, result, (response, created) =>
        sendJson(response, toGuestRsvpCreatedDto(created), 201),
      )
    }),
  )

  router.get(
    '/i/:token/rsvp',
    read,
    asyncHandler(async (req, res) => {
      const token = tokenOf(req)
      if (token === null) return sendError(res, notAvailable())

      const result = await usecases.getOwnRsvp({ token, editToken: editTokenOf(req) })

      sendResult(res, result, (response, rsvp) =>
        sendJson(response, toGuestOwnRsvpResponseDto(rsvp)),
      )
    }),
  )

  router.put(
    '/i/:token/rsvp',
    ...rsvpWriteLimiters,
    asyncHandler(async (req, res) => {
      const token = tokenOf(req)
      if (token === null) return sendError(res, notAvailable())
      const body = guestRsvpBody.parse(req.body)

      const result = await usecases.updateOwnRsvp({
        token,
        editToken: editTokenOf(req),
        ...body,
      })

      sendResult(res, result, (response, rsvp) =>
        sendJson(response, toGuestOwnRsvpResponseDto(rsvp)),
      )
    }),
  )

  router.delete(
    '/i/:token/rsvp',
    ...rsvpWriteLimiters,
    asyncHandler(async (req, res) => {
      const token = tokenOf(req)
      if (token === null) return sendError(res, notAvailable())

      const result = await usecases.deleteOwnRsvp({ token, editToken: editTokenOf(req) })

      sendResultNoContent(res, result)
    }),
  )

  return router
}
