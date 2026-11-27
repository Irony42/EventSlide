import { Router, type RequestHandler } from 'express'
import { DomainError } from '../../../domain/shared/errors'
import { signupEnabled } from '../../../domain/signups/signupMode'
import { asyncHandler } from '../middleware/asyncHandler'
import { answerUndecodablePath } from '../middleware/errorHandler'
import { invitationLimiter, signupLimiter } from '../middleware/rateLimit'
import { sendError, sendJson, sendResult } from '../presenters/send'
import { invitationTokenParams, signupRequestBody } from '../schemas/requestSchemas'
import type { HttpDeps } from '../types'
import type { HttpUseCases } from '../useCases'

/**
 * The visitor's side of self-service signup (spec 31, ADR 0018): the form, what a mailed link is, and
 * pressing "Confirm".
 *
 * **Genuinely public, and each route says so.** Nobody is signed in; the credential, where there is one,
 * is the link. What belongs on a route like this is a limiter per client address, the answer kept out of
 * every cache, and **the same answer** for everything that depends on what the box knows about an address.
 *
 * - **While `SIGNUP=off` every route is `404 feature.unavailable`**, before the body is read by any use
 *   case and before a limiter is spent. It depends on configuration alone.
 * - `POST /signup` is `202 {status}`: `sent` for a new address, a known one, one already waiting, one
 *   refused lately, one over its cap and a filled honeypot alike; `busy` only when the whole box has reached
 *   its confirmations for the day. Its limiter is per hour (`SIGNUP_RATE_LIMIT_PER_HOUR`), and the body is read
 *   up to 4 KB by `server.ts`, ahead of the global parser. The mail is sent behind `completion`, which the
 *   response does not wait for.
 * - `GET /signup/confirm/:token` spends nothing (a mail scanner opens links); `POST` confirms. A link that is
 *   unknown, malformed, spent, revoked or expired is the same `404 signup.confirmationNotFound`.
 *
 * The token is in the path and the logged path replaces it with `:token` (`loggablePath`). CSRF is the
 * ordinary gate every public write meets (`requireCsrfToken`, ahead of this router).
 */

export interface SignupRouteDeps {
  readonly deps: HttpDeps
  readonly usecases: Pick<
    HttpUseCases,
    'requestSignup' | 'previewSignupConfirmation' | 'confirmSignup'
  >
}

export const signupRoutes = ({ deps, usecases }: SignupRouteDeps): Router => {
  const router = Router()

  // One limiter per route, built once: each has its own store, so looking at links does not spend the
  // allowance of the form. The form's is hourly; the links' are the sign-in budget, as an invitation's.
  const formLimiter = signupLimiter(deps.config.signup.rateLimitPerHour)
  const previewLimiter = invitationLimiter(deps.config.rateLimits.loginPerMinute)
  const confirmLimiter = invitationLimiter(deps.config.rateLimits.loginPerMinute)

  /** The refusal of a box with signup off: configuration, never the caller. */
  const unavailable: RequestHandler = (_req, res, next) => {
    if (signupEnabled(deps.config.signup.mode)) {
      next()
      return
    }
    res.setHeader('Cache-Control', 'no-store')
    sendError(res, DomainError.notFound('feature.unavailable'))
  }

  router.post(
    '/signup',
    // Genuinely public: a stranger asking for an account, and that is the whole point. The switch first,
    // then the limiter that belongs here.
    unavailable,
    formLimiter,
    asyncHandler(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store')
      const body = signupRequestBody.parse(req.body)

      const result = await usecases.requestSignup({
        email: body.email,
        clientName: body.clientName,
        ...(body.note === undefined ? {} : { note: body.note }),
        ...(body.eventDate === undefined || body.eventDate === ''
          ? {}
          : { eventDate: body.eventDate }),
        locale: body.locale,
        website: body.website,
      })
      if (!result.ok) {
        sendError(res, result.error)
        return
      }
      // The mail is behind `completion`, deliberately not awaited: how long a relay takes to say yes would
      // tell an address that is mailed from one that is not.
      res.status(202).json({ status: result.value.status })
    }),
  )

  /** A request that is not a link at all is answered like a dead one. */
  const notFound = (): DomainError => DomainError.notFound('signup.confirmationNotFound')

  router.get(
    '/signup/confirm/:token',
    // Genuinely public: the link is the credential, and looking at it spends nothing.
    unavailable,
    previewLimiter,
    asyncHandler(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store')
      const params = invitationTokenParams.safeParse(req.params)
      if (!params.success) {
        sendError(res, notFound())
        return
      }
      const result = await usecases.previewSignupConfirmation({ token: params.data.token })
      sendResult(res, result, (response, preview) =>
        sendJson(response, { state: preview.state, maskedEmail: preview.maskedEmail }),
      )
    }),
  )

  router.post(
    '/signup/confirm/:token',
    // Genuinely public, for the same reason, and the one route that can open an account: the link spent
    // here is the proof of the mailbox. No body.
    unavailable,
    confirmLimiter,
    asyncHandler(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store')
      const params = invitationTokenParams.safeParse(req.params)
      if (!params.success) {
        sendError(res, notFound())
        return
      }
      const result = await usecases.confirmSignup({ token: params.data.token })
      // `next` and nothing else: never a link, never the address.
      sendResult(res, result, (response, confirmed) => sendJson(response, { next: confirmed.next }))
    }),
  )

  // A path Express cannot decode (`/signup/confirm/%`) is a dead link, answered like every other.
  router.use(
    answerUndecodablePath((res) => {
      res.setHeader('Cache-Control', 'no-store')
      sendError(res, notFound())
    }),
  )

  return router
}
