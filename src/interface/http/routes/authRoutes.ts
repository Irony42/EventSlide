import { Router } from 'express'
import type { Session } from 'express-session'
import { DomainError } from '../../../domain/shared/errors'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireUser } from '../middleware/authz'
import { loginLimiter } from '../middleware/rateLimit'
import { toSessionResponseDto, toSignedInUserDto } from '../presenters/presenters'
import { sendError, sendJson, sendNoContent, sendResult } from '../presenters/send'
import { changePasswordBody, loginBody } from '../schemas/requestSchemas'
import type { HttpDeps, SessionPayload } from '../types'
import type { HttpUseCases } from '../useCases'

/**
 * Sign in, sign out, who am I, change my password.
 *
 * These are the only routes in the API that are not scoped to an event, so they are
 * also the only ones where "is there a principal at all" is the whole question. Three
 * of them are therefore genuinely public — a route that establishes a principal has
 * none to authorize yet, and the route that reports whether a principal exists cannot
 * require one — and each says so where it is defined, rather than leaving a reader to
 * infer it from an absent middleware.
 */

/**
 * Must match the `name` given to `express-session` in `server.ts`.
 *
 * Exported so the logout clear and its test agree on one literal: a browser matches a
 * cookie deletion on name, domain and path, so a mismatch here would silently leave
 * the cookie in place and nothing would fail until the next request.
 */
export const SESSION_COOKIE = 'es_session'

/**
 * `regenerate` and `destroy` are callback-based, and a dropped error from either is a
 * security defect rather than a glitch — so they are promisified here and a rejection
 * travels to the error handler through `asyncHandler`. A login that silently kept the
 * old session id would be worse than a login that failed: the fixation defence would
 * be gone with nothing to show for it.
 */
const promisify = (
  operation: (done: (error: unknown) => void) => unknown,
  label: string,
): Promise<void> =>
  new Promise((resolve, reject) => {
    operation((error: unknown) => {
      if (error) {
        reject(error instanceof Error ? error : new Error(label))
        return
      }
      resolve()
    })
  })

const regenerateSession = (session: Session): Promise<void> =>
  promisify((done) => session.regenerate(done), 'session regeneration failed')

const destroySession = (session: Session): Promise<void> =>
  promisify((done) => session.destroy(done), 'session destruction failed')

/**
 * Narrower than `RouteDeps` on purpose.
 *
 * The module names the two use cases it calls, so a third cannot quietly be reached
 * for here and a test can build exactly this bag from fakes instead of standing up the
 * whole application. `server.ts` passes its wider bag unchanged.
 */
export interface AuthRouteDeps {
  readonly deps: HttpDeps
  readonly usecases: Pick<HttpUseCases, 'authenticateUser' | 'changePassword'>
}

export const authRoutes = ({ deps, usecases }: AuthRouteDeps): Router => {
  const router = Router()

  router.post(
    '/auth/login',
    // Genuinely public: this route is where a principal comes from, so there is none to
    // authorize. The limiter is the control that belongs here — with bcrypt's cost it
    // puts online guessing out of reach, and 1.0 had neither.
    loginLimiter(deps.config.rateLimits.loginPerMinute),
    asyncHandler(async (req, res) => {
      const body = loginBody.parse(req.body)

      const result = await usecases.authenticateUser({
        email: body.email,
        password: body.password,
      })

      if (!result.ok) {
        // Not `sendResult`: the success path has to await session regeneration, which
        // a synchronous presenter cannot. There is nothing to map here either — every
        // failure this use case can return is the same `401 auth.invalidCredentials`,
        // because an unknown address, a wrong password and a disabled account must be
        // indistinguishable or the login form becomes an account-enumeration oracle.
        sendError(res, result.error)
        return
      }

      // Before a single field is written into it. Someone who plants a session id — via
      // a subdomain, a proxy, or a link carrying it — must not still hold a valid
      // session once the victim signs in. 1.0 never regenerated, so a planted id
      // survived the login and took the account with it.
      await regenerateSession(req.session)

      const payload: SessionPayload = {
        userId: result.value.userId,
        email: result.value.email,
        mustChangePassword: result.value.mustChangePassword,
      }
      // The entire session: an identity, nothing worth stealing, and nothing that goes
      // stale. 1.0's `deserializeUser` did a `SELECT *` and hung the whole user row,
      // bcrypt hash included, off every authenticated request.
      Object.assign(req.session, payload)

      sendJson(res, toSignedInUserDto(result.value))
    }),
  )

  router.post(
    '/auth/logout',
    // Genuinely public, and deliberately so: a caller can only ever destroy the session
    // they present. Requiring one would answer 401 to a client whose session has
    // already expired — precisely the moment it asks to log out — and would leave the
    // stale cookie sitting in the browser.
    asyncHandler(async (req, res) => {
      await destroySession(req.session)

      // `destroy` removes the stored row but says nothing to the browser. Without this
      // the cookie stays and every later request costs a store lookup for a session
      // that no longer exists. The attributes mirror `server.ts`, since a deletion is
      // matched on name, domain and path.
      res.clearCookie(SESSION_COOKIE, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: deps.config.secureCookie,
      })

      sendNoContent(res)
    }),
  )

  router.get(
    '/auth/me',
    // Genuinely public because the answer *is* whether the caller has a session:
    // requiring one would make the question unanswerable. 200 with
    // `{ authenticated: false }` rather than 401 — the client asks this on every page
    // load, and a 401 in the console on a first visit is noise (docs/API.md §5).
    (req, res) => {
      // Never stored. This read carries the identity itself, and `rolling: true` on the
      // session means an authenticated one also carries a fresh `Set-Cookie` — so a
      // shared cache holding this response would hand one host's session to whoever
      // asks next. Every principal-scoped read in this API says so explicitly.
      res.setHeader('Cache-Control', 'no-store')

      sendJson(res, toSessionResponseDto(req.context.user))
    },
  )

  router.post(
    '/auth/password',
    requireUser,
    asyncHandler(async (req, res) => {
      const user = req.context.user
      if (!user) {
        // `requireUser` always populates it; this keeps the type honest without the
        // non-null assertion the strict settings forbid.
        sendError(res, DomainError.unauthenticated('auth.required'))
        return
      }

      const body = changePasswordBody.parse(req.body)

      const result = await usecases.changePassword({
        // From the session, never from the body. A `userId` a client could send would
        // turn this endpoint into a password reset for any account on the box, which is
        // why `changePasswordBody` is `.strict()` and refuses the field outright.
        userId: user.userId,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
      })

      sendResult(res, result, (response) => {
        // The invitation gate closes here rather than at the next sign-in: the "choose
        // your password" screen is what called this, and it has to be able to move on
        // without a reload.
        const cleared: SessionPayload = { mustChangePassword: false }
        Object.assign(req.session, cleared)

        sendNoContent(response)
      })
    }),
  )

  return router
}
