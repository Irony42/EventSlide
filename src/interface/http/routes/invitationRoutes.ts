import { Router, type NextFunction, type Request, type Response } from 'express'
import { DomainError } from '../../../domain/shared/errors'
import { asyncHandler } from '../middleware/asyncHandler'
import { resolveAuthState } from '../middleware/authz'
import { isUndecodablePath } from '../middleware/errorHandler'
import { invitationLimiter } from '../middleware/rateLimit'
import { toInvitationAcceptedDto, toInvitationPreviewDto } from '../presenters/presenters'
import { sendError, sendJson, sendResult } from '../presenters/send'
import { acceptInvitationBody, invitationTokenParams } from '../schemas/requestSchemas'
import type { HttpDeps } from '../types'
import type { HttpUseCases } from '../useCases'
import { startSession } from './authRoutes'

/**
 * The invitee's side of an invitation link (docs/ROADMAP.md §10.3; free plan G2-09, paid plan
 * P3-10): what the link offers, and accepting it.
 *
 * **Both are genuinely public, and each says so.** The person holding a link has, by
 * definition, no account to be authorized as — or has one they have not signed in to — and
 * the link is the credential. What belongs on a route like that is a limiter per client
 * address, the response kept out of every cache, and **one refusal** for every way a link can
 * be useless: unknown, malformed, spent, revoked, expired, waiting for an approval, for an
 * event that is gone. A malformed token is answered like a dead one, because telling them
 * apart would tell a stranger probing links which of them ever existed.
 *
 * The token is in the path (`/api/invitations/:token`) and the logged path replaces it with
 * `:token` (`loggablePath`), as for a gallery's and a reset's.
 */

export interface InvitationRouteDeps {
  readonly deps: HttpDeps
  readonly usecases: Pick<HttpUseCases, 'previewInvitation' | 'acceptInvitation'>
}

/** What a request that is not a link at all is answered with: the same as a dead one. */
const notFound = (): DomainError => DomainError.notFound('invitation.notFound')

export const invitationRoutes = ({ deps, usecases }: InvitationRouteDeps): Router => {
  const router = Router()

  // One limiter per route, built here once: `express-rate-limit` gives every call its own
  // store, so these are two allowances by design (see `invitationLimiter`).
  const previewLimiter = invitationLimiter(deps.config.rateLimits.loginPerMinute)
  const acceptLimiter = invitationLimiter(deps.config.rateLimits.loginPerMinute)

  router.get(
    '/invitations/:token',
    // Genuinely public: the link is the credential, and looking at it spends nothing. The
    // limiter is the control that belongs here.
    previewLimiter,
    asyncHandler(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store')
      const params = invitationTokenParams.safeParse(req.params)
      if (!params.success) {
        sendError(res, notFound())
        return
      }

      const result = await usecases.previewInvitation({ token: params.data.token })
      sendResult(res, result, (response, preview) =>
        sendJson(response, toInvitationPreviewDto(preview)),
      )
    }),
  )

  router.post(
    '/invitations/:token/accept',
    // Genuinely public, for the same reason, and the one route that can create an account:
    // with a name and a password it is a person choosing how to sign in, with an empty body
    // it is the signed-in account whose address the link was written to. The limiter is
    // per client address; the per-address cap and the single-use link do the rest.
    acceptLimiter,
    asyncHandler(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store')
      const params = invitationTokenParams.safeParse(req.params)
      if (!params.success) {
        sendError(res, notFound())
        return
      }
      const body = acceptInvitationBody.parse(req.body)

      if ('password' in body) {
        const result = await usecases.acceptInvitation({
          token: params.data.token,
          credentials: { password: body.password, displayName: body.displayName },
        })
        if (!result.ok) {
          sendError(res, result.error)
          return
        }
        // The person has just chosen a password, which is a sign-in: the same fresh session
        // and CSRF token a login gets, so they arrive on the event signed in. Nothing is
        // started for a refusal, and a failure to start leaves the account made and the
        // link spent — the person signs in with the password they chose.
        await startSession(req, res, deps, {
          userId: result.value.userId,
          email: result.value.email,
        })
        sendJson(res, toInvitationAcceptedDto(result.value))
        return
      }

      // No credentials: the account is the **session's**, never the request's.
      const user = req.context.user
      const state = user === undefined ? undefined : await resolveAuthState(deps, req)
      if (user === undefined || state?.active !== true) {
        // 400 and not 401: this route is public, and what an anonymous caller who sent
        // nothing to go on has is a request with no credentials in it — a name and a
        // password, or a session. The page asks the session first and sends this form only
        // for a person it knows is signed in; a session that lapsed in between lands here.
        sendError(res, DomainError.invalid('invitation.credentialsRequired'))
        return
      }
      const result = await usecases.acceptInvitation({
        token: params.data.token,
        signedInUserId: user.userId,
      })
      sendResult(res, result, (response, accepted) =>
        sendJson(response, toInvitationAcceptedDto(accepted)),
      )
    }),
  )

  // Express decodes a path parameter while it **matches** the route, before any handler or
  // limiter runs, and throws a `URIError` for `%`, `%zz` or a truncated sequence. Left alone that
  // is a 500 and an error line in the log for anybody who types it; a malformed link is a dead
  // link, answered like every other. Only the router's own refusal is answered here, by the same
  // test the error handler and the gallery router use (a `URIError` **stamped** `status: 400`),
  // so a `URIError` of ours in a handler above, or an error a library stamped 400, stays a bug:
  // a 500 with its line in the log, not a quiet 404.
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!isUndecodablePath(error)) {
      next(error)
      return
    }
    res.setHeader('Cache-Control', 'no-store')
    sendError(res, notFound())
  })

  return router
}
