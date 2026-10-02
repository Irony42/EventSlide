import { Router, type Request, type Response } from 'express'
import type { Session } from 'express-session'
import { DomainError } from '../../../domain/shared/errors'
import { DEFAULT_SITE_ROLE } from '../../../domain/users/siteRole'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireUser, resolveAuthState } from '../middleware/authz'
import { rotateCsrfToken } from '../middleware/csrf'
import { loginLimiter, passwordResetLimiter } from '../middleware/rateLimit'
import { toSessionResponseDto, toSignedInUserDto } from '../presenters/presenters'
import { sendError, sendJson, sendNoContent, sendResultNoContent } from '../presenters/send'
import {
  changePasswordBody,
  loginBody,
  passwordResetConfirmBody,
  passwordResetRequestBody,
} from '../schemas/requestSchemas'
import type { HttpDeps, SessionPayload } from '../types'
import type { HttpUseCases } from '../useCases'

/**
 * Sign in, sign out, who am I, change my password, sign out everywhere.
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
 * Gives the caller a brand-new session: a new id, a new CSRF token, and an identity stamped
 * with *now*. The login uses it, and so does every change of credentials that must leave the
 * person who made it signed in.
 *
 * **Why those three belong together.**
 *
 * - The regeneration replaces the id that says *who* the caller is. Someone who planted a
 *   session id — via a subdomain, a proxy, or a link carrying it — must not still hold a
 *   valid session once the victim signs in or changes their password. 1.0 never
 *   regenerated, so a planted id survived the login and took the account with it.
 * - The CSRF rotation replaces the token that says *which page* may act on their behalf.
 *   Leaving it would mean one `es_csrf` spanning the old identity and the new one — the
 *   defect F9 names — so anything that learnt the value before still holds a valid half of
 *   the pair after it.
 * - `renewedAt` is what the credentials epoch is compared against (`enforceSessionAge`). A
 *   password change raises the epoch to the instant it happened and then calls this, whose
 *   stamp is not earlier: the session the person ends up with survives the change they
 *   just made, and every other one does not.
 * - `issuedAt` is the person's sign-in, which the absolute cap measures. **A login writes it
 *   and a renewal carries it over** (`carryIssuedAt`): if a renewal restarted it, a stolen
 *   cookie could call `revoke-others` once every six days and never reach the cap, and a
 *   week-long ceiling would quietly become "until the victim notices".
 *
 * The regeneration comes first and the rotation after it, never before: a regeneration
 * that fails must leave the response with no `Set-Cookie` at all, which is what the
 * failure tests assert. The gate already ran and passed on this request, so the client
 * needs the new CSRF value only from the next one.
 *
 * The session holds an identity, nothing worth stealing, and nothing that goes stale.
 * Deliberately not `mustChangePassword`: `SessionPayload`'s own doc comment says why, and
 * `requirePasswordCurrent` reads the flag from storage on every request.
 *
 * Both stamps are written here and nowhere else: refreshing `issuedAt` anywhere would turn
 * the absolute cap back into the idle timeout it exists to sit behind.
 */
const startSession = async (
  req: Request,
  res: Response,
  deps: HttpDeps,
  who: { readonly userId: string; readonly email: string },
  /**
   * The sign-in instant to keep, for a renewal; omitted by a login, which is the sign-in.
   * Read from the session **before** it is regenerated, because regenerating empties it.
   */
  carryIssuedAt?: number,
): Promise<void> => {
  await regenerateSession(req.session)
  rotateCsrfToken(res, { secureCookie: deps.config.secureCookie })

  const now = deps.clock.now().getTime()
  const payload: SessionPayload = {
    userId: who.userId,
    email: who.email,
    issuedAt: carryIssuedAt ?? now,
    renewedAt: now,
  }
  Object.assign(req.session, payload)
}

/** The sign-in instant of the session this request arrived with, to hand to a renewal. */
const signedInAtOf = (req: Request): number | undefined => {
  const issuedAt = (req.session as unknown as SessionPayload).issuedAt
  return typeof issuedAt === 'number' ? issuedAt : undefined
}

/**
 * Narrower than `RouteDeps` on purpose.
 *
 * The module names the use cases it calls, so another cannot quietly be reached
 * for here and a test can build exactly this bag from fakes instead of standing up the
 * whole application. `server.ts` passes its wider bag unchanged.
 */
export interface AuthRouteDeps {
  readonly deps: HttpDeps
  readonly usecases: Pick<
    HttpUseCases,
    | 'authenticateUser'
    | 'changePassword'
    | 'revokeOtherSessions'
    | 'requestPasswordReset'
    | 'resetPassword'
  >
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

      await startSession(req, res, deps, result.value)

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

      // Replaced rather than cleared. The page that called this is still open and still
      // needs to be able to act — the join page and the wall are public, and a guest on
      // a shared phone signing the host out must not lose their own ability to upload —
      // so what is issued here is a fresh anonymous token, not the absence of one.
      //
      // Rotating matters as much here as on the login: the browser has just stopped
      // being a host, and a token that carried over would still be the one a page opened
      // during the session holds.
      rotateCsrfToken(res, { secureCookie: deps.config.secureCookie })

      sendNoContent(res)
    }),
  )

  router.get(
    '/auth/me',
    // Genuinely public because the answer *is* whether the caller has a session:
    // requiring one would make the question unanswerable. 200 with
    // `{ authenticated: false }` rather than 401 — the client asks this on every page
    // load, and a 401 in the console on a first visit is noise (docs/API.md §5).
    asyncHandler(async (req, res) => {
      // Never stored. This read carries the identity itself, and `rolling: true` on the
      // session means an authenticated one also carries a fresh `Set-Cookie` — so a
      // shared cache holding this response would hand one host's session to whoever
      // asks next. Every principal-scoped read in this API says so explicitly.
      res.setHeader('Cache-Control', 'no-store')

      // The account, not only the session. This is the answer the admin shell routes
      // on, so a disabled host who is told `authenticated: true` is let into a console
      // where every request then fails — the shape of the defect rather than a cosmetic
      // wart. `resolveAuthState` is the same single read `requirePasswordCurrent` already
      // made ahead of this handler on a real server (`server.ts`'s mount order); asking
      // again here costs nothing when it did and is still exactly one read when it did
      // not, as in a test that drives this router on its own.
      const user = req.context.user
      const state = user === undefined ? undefined : await resolveAuthState(deps, req)
      const principal = user !== undefined && state?.active === true ? user : undefined

      // The authority over the box, from storage on this request like everything else this
      // handler reports — and asked only for an account that may act at all: a disabled
      // operator is told it is not signed in and learns nothing else, and an anonymous
      // caller costs no query. A second narrow read on purpose; folding the role into
      // `AuthState` would make this one read and is left to the item that already
      // changes that query (the credential epoch, P3-09).
      const siteRole =
        principal === undefined ? DEFAULT_SITE_ROLE : await deps.users.siteRoleFor(principal.userId)

      sendJson(res, toSessionResponseDto(principal, state?.mustChangePassword ?? false, siteRole))
    }),
  )

  router.post(
    '/auth/password',
    requireUser(deps),
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

      if (!result.ok) {
        sendError(res, result.error)
        return
      }

      // `changePassword` raised the credentials epoch to now, which ends *every* session
      // of this account, this one included. Renew this one — a new id, a new CSRF token, an
      // `renewedAt` that is not before the epoch — so the person who chose the password stays
      // signed in on the device they chose it on, and on no other. Their sign-in instant is
      // carried over: choosing a password does not make the session any younger.
      //
      // The `mustChangePassword` flag needs no session write: `changePassword` cleared it
      // in storage and `resolveAuthState` reads it from there on the next request.
      await startSession(req, res, deps, user, signedInAtOf(req))
      sendNoContent(res)
    }),
  )

  router.post(
    '/auth/password-reset/request',
    // Genuinely public: the person asking has, by definition, no credential. The limiter is
    // the per-client half of the defence; the per-address half (at most three mails an hour
    // to any one inbox) is inside the use case, because it has to count what was issued.
    passwordResetLimiter(deps.config.rateLimits.loginPerMinute),
    asyncHandler(async (req, res) => {
      const body = passwordResetRequestBody.parse(req.body)

      const result = await usecases.requestPasswordReset({
        email: body.email,
        locale: body.locale,
      })

      // Whatever the answer, it is a function of this request and nobody else's.
      res.setHeader('Cache-Control', 'no-store')

      if (!result.ok) {
        // The one refusal, and it depends on the box rather than on the address: with no
        // mail relay there is no self-service reset (`404 feature.unavailable`).
        sendError(res, result.error)
        return
      }

      // Accepted, and nothing more is said: not whether the address is an account, not
      // whether it was mailed, not whether it was over its cap. The work is already running
      // behind `result.value.completion`, and this response deliberately does not wait for
      // it — how long a mail relay takes to say yes is a way of telling an address that
      // exists from one that does not, and the body would be the same either way.
      res.status(202).json({})
    }),
  )

  router.post(
    '/auth/password-reset/confirm',
    // Genuinely public, for the same reason: the link is the credential, and it is spent by
    // whoever holds it. The token is 256 random bits, so the limiter is about cost — hashing
    // and a lookup per attempt — and not about guessing.
    passwordResetLimiter(deps.config.rateLimits.loginPerMinute),
    asyncHandler(async (req, res) => {
      const body = passwordResetConfirmBody.parse(req.body)

      const result = await usecases.resetPassword({
        token: body.token,
        newPassword: body.password,
      })

      res.setHeader('Cache-Control', 'no-store')

      // No session is started: the person has proved a mailbox, not signed in. The use case
      // raised the credentials epoch, so a session that was open anywhere — here included —
      // is refused on its next request.
      sendResultNoContent(res, result)
    }),
  )

  router.post(
    '/auth/sessions/revoke-others',
    // Any signed-in account, for itself and nobody else: the account comes from the
    // session, never from the request. No body is read, so there is nothing to parse and
    // nothing a caller could point at another account.
    requireUser(deps),
    asyncHandler(async (req, res) => {
      const user = req.context.user
      if (!user) {
        sendError(res, DomainError.unauthenticated('auth.required'))
        return
      }

      const result = await usecases.revokeOtherSessions({ userId: user.userId })
      if (!result.ok) {
        sendError(res, result.error)
        return
      }

      // "Everywhere" includes this device's own cookie, because the epoch is a point in
      // time and not a list of ids to spare. Put a fresh session in its place before
      // answering, or the button would sign out the person who pressed it. Their sign-in
      // instant is kept: pressing the button does not make the session any younger.
      await startSession(req, res, deps, user, signedInAtOf(req))
      sendNoContent(res)
    }),
  )

  return router
}
