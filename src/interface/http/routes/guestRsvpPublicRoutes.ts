import { Router, type Request, type RequestHandler } from 'express'
import { DomainError } from '../../../domain/shared/errors'
import { asyncHandler } from '../middleware/asyncHandler'
import {
  toGuestHouseholdResponseDto,
  toGuestOwnRsvpResponseDto,
  toGuestRsvpCreatedDto,
} from '../presenters/rsvpPresenters'
import { sendError, sendJson, sendResult, sendResultNoContent } from '../presenters/send'
import {
  guestInviteTokenParams,
  guestRsvpBody,
  guestRsvpCreateBody,
  absentNoteBody,
} from '../schemas/requestSchemas'
import type { GuestAbsentNoteResponseDto } from '../presenters/dto'
import type { HttpUseCases, RouteDeps } from '../useCases'

/**
 * The guests' replies, the guest's side (spec 30): answer on the invitation's page, read, change and
 * delete one's own reply. **The first public write nobody is signed in for**, so every guard is
 * spelled out:
 *
 * - **a household's personal link** (lot 3) is the same kind of key: the **`X-Household-Token`
 *   header**, never a path or a query, bound to this event, and it opens the household's one reply
 *   (`GET /i/:token/household`, and `POST`, `GET`, `PUT`, `DELETE …/rsvp` on it). An unknown one is
 *   the same `404 rsvp.notFound` as a dead reply token;
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
    | 'submitRsvp'
    | 'getOwnRsvp'
    | 'updateOwnRsvp'
    | 'deleteOwnRsvp'
    | 'viewHousehold'
    | 'postAbsentNote'
  >
  /** One instance for the three writes: built once by `server.ts`. */
  readonly rsvpWriteLimiters: readonly RequestHandler[]
  /** The page's own read limiter, **shared** with `guestInvitePublicRoutes`: one budget for a guesser. */
  readonly inviteReadLimiter: RequestHandler
}

const EDIT_TOKEN_HEADER = 'x-rsvp-token'
/** A household's own link (lot 3): the same reach as a reply token, for the household's one reply. */
const HOUSEHOLD_TOKEN_HEADER = 'x-household-token'

/** A token that is not token-shaped is answered exactly as a dead one. */
const tokenOf = (req: Request): string | null => {
  const parsed = guestInviteTokenParams.safeParse(req.params)
  return parsed.success ? parsed.data.token : null
}

/** The guest's own token: the one header, read as text if it is text and nothing otherwise. */
const editTokenOf = (req: Request): string | undefined => req.get(EDIT_TOKEN_HEADER)

/** The household's link, when the call carries one: in the header, never a path or a query. */
const householdTokenOf = (req: Request): string | undefined => req.get(HOUSEHOLD_TOKEN_HEADER)

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

      const result = await usecases.submitRsvp({
        token,
        householdToken: householdTokenOf(req),
        ...body,
      })

      // 201 for a reply that was made, 200 for a household's existing reply that was changed.
      sendResult(res, result, (response, created) =>
        sendJson(
          response,
          created.editToken === null
            ? toGuestOwnRsvpResponseDto(created.rsvp)
            : toGuestRsvpCreatedDto({ rsvp: created.rsvp, editToken: created.editToken }),
          created.created ? 201 : 200,
        ),
      )
    }),
  )

  /** A household opens its personal link: its name, its places and its reply (header `X-Household-Token`). */
  router.get(
    '/i/:token/household',
    read,
    asyncHandler(async (req, res) => {
      const token = tokenOf(req)
      if (token === null) return sendError(res, notAvailable())

      const result = await usecases.viewHousehold({ token, householdToken: householdTokenOf(req) })

      sendResult(res, result, (response, viewed) =>
        sendJson(response, toGuestHouseholdResponseDto(viewed)),
      )
    }),
  )

  router.get(
    '/i/:token/rsvp',
    read,
    asyncHandler(async (req, res) => {
      const token = tokenOf(req)
      if (token === null) return sendError(res, notAvailable())

      const result = await usecases.getOwnRsvp({
        token,
        editToken: editTokenOf(req),
        householdToken: householdTokenOf(req),
      })

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
        householdToken: householdTokenOf(req),
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

      const result = await usecases.deleteOwnRsvp({
        token,
        editToken: editTokenOf(req),
        householdToken: householdTokenOf(req),
      })

      sendResultNoContent(res, result)
    }),
  )

  /**
   * The word of a guest who answered "no" (lot 4): the reply's own token (or a household's link), the write
   * limiter, a 4 KB body, the guestbook's text rules and ceilings, and the honeypot. `201 { absentNoteSent }`.
   */
  router.post(
    '/i/:token/absent-note',
    ...rsvpWriteLimiters,
    asyncHandler(async (req, res) => {
      const token = tokenOf(req)
      if (token === null) return sendError(res, notAvailable())
      const body = absentNoteBody.parse(req.body)

      const result = await usecases.postAbsentNote({
        token,
        editToken: editTokenOf(req),
        householdToken: householdTokenOf(req),
        ...body,
      })

      sendResult(res, result, (response) =>
        sendJson<GuestAbsentNoteResponseDto>(response, { absentNoteSent: true }, 201),
      )
    }),
  )

  return router
}
