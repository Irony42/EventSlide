import type { Request, Response } from 'express'
import type { Session } from 'express-session'
import { PENDING_SECOND_FACTOR_LIFETIME_MS, isStampFresh } from '../../../domain/users/secondFactor'
import type { HttpDeps, PendingSecondFactor, SessionPayload } from '../types'
import { rotateCsrfToken } from './csrf'

/**
 * Must match the `name` given to `express-session` in `server.ts`.
 *
 * Exported so `endSession` and its test agree on one literal: a browser matches a
 * cookie deletion on name, domain and path, so a mismatch here would silently leave
 * the cookie in place and nothing would fail until the next request.
 */
export const SESSION_COOKIE = 'es_session'

/**
 * The session lifecycle: starting one, parking a half-finished sign-in, ending one.
 *
 * Here, and not in `routes/authRoutes.ts`, because more than one route starts a session
 * (the sign-in routes and the invitation acceptance) and a route file may not import another.
 */

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

export const regenerateSession = (session: Session): Promise<void> =>
  promisify((done) => session.regenerate(done), 'session regeneration failed')

export const destroySession = (session: Session): Promise<void> =>
  promisify((done) => session.destroy(done), 'session destruction failed')

/**
 * Ends the caller's session, on the server and in the browser: destroys it, clears the cookie that
 * named it and replaces the CSRF token. Used by the logout and by the erasure of the caller's own
 * account, which end a session the same way.
 *
 * `destroy` removes the stored row but says nothing to the browser. Without the clear the cookie
 * stays and every later request costs a store lookup for a session that no longer exists. The
 * attributes mirror `server.ts`, since a deletion is matched on name, domain and path.
 *
 * The CSRF token is replaced rather than cleared. The page that called this is still open and still
 * needs to be able to act — the join page and the wall are public, and a guest on a shared phone
 * signing the host out must not lose their own ability to upload — so what is issued is a fresh
 * anonymous token, not the absence of one. Rotating matters as much here as on the login: the
 * browser has just stopped being a host, and a token that carried over would still be the one a
 * page opened during the session holds.
 */
export const endSession = async (req: Request, res: Response, deps: HttpDeps): Promise<void> => {
  await destroySession(req.session)
  res.clearCookie(SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: deps.config.secureCookie,
  })
  rotateCsrfToken(res, { secureCookie: deps.config.secureCookie })
}

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
export const startSession = async (
  req: Request,
  res: Response,
  deps: HttpDeps,
  who: { readonly userId: string; readonly email: string },
  /**
   * What to keep from the session this request arrived with, for a renewal; omitted by a
   * login, which starts everything afresh. Read from the session **before** it is
   * regenerated, because regenerating empties it.
   *
   * `issuedAt` is the sign-in instant (see above). `secondFactorAt` is when the session
   * passed the second factor: **a renewal keeps it** — choosing a new password does not make
   * the person less who they proved they are — and **only a passed factor writes a new one**.
   * `stepUpAt` is deliberately not here: a new session id starts with nothing confirmed.
   */
  stamps: SessionStamps = {},
): Promise<void> => {
  await regenerateSession(req.session)
  rotateCsrfToken(res, { secureCookie: deps.config.secureCookie })

  const now = deps.clock.now().getTime()
  const payload: SessionPayload = {
    userId: who.userId,
    email: who.email,
    issuedAt: stamps.issuedAt ?? now,
    renewedAt: now,
    ...(stamps.secondFactorAt === undefined ? {} : { secondFactorAt: stamps.secondFactorAt }),
  }
  Object.assign(req.session, payload)
}

export interface SessionStamps {
  readonly issuedAt?: number
  readonly secondFactorAt?: number
}

/**
 * The stamps of the session this request arrived with, to hand to a renewal: when the person
 * signed in, and when (if ever) they passed the second factor.
 */
export const stampsOf = (req: Request): SessionStamps => {
  const session = req.session as unknown as SessionPayload
  return {
    ...(typeof session.issuedAt === 'number' ? { issuedAt: session.issuedAt } : {}),
    ...(typeof session.secondFactorAt === 'number'
      ? { secondFactorAt: session.secondFactorAt }
      : {}),
  }
}

/**
 * Parks a sign-in that has passed the password and not the second factor (G2-13 / P3-15).
 *
 * A fresh session id and a fresh CSRF token, for the reason a login gets them: the caller's
 * identity is about to change, if only partly. What the session holds is
 * `pendingSecondFactor` and **no `userId`**, which is what every gate keys on — so until
 * the second step passes, this session is anonymous to `attachUser`, `requireUser`,
 * `requireRole` and `requireOperator` alike, and no route that needs a principal can be
 * reached with it. Five wrong codes end the attempt and the password has to be typed again;
 * that count is the use case's, keyed by this session's id, and not a number in the session: a
 * session is copied into every request that carries it, so a copy cannot count what the others do.
 */
export const startPendingSecondFactor = async (
  req: Request,
  res: Response,
  deps: HttpDeps,
  who: PendingIdentity,
): Promise<void> => {
  await regenerateSession(req.session)
  rotateCsrfToken(res, { secureCookie: deps.config.secureCookie })

  const pending: PendingSecondFactor = {
    userId: who.userId,
    email: who.email,
    displayName: who.displayName,
    mustChangePassword: who.mustChangePassword,
    startedAt: deps.clock.now().getTime(),
  }
  Object.assign(req.session, { pendingSecondFactor: pending } satisfies SessionPayload)
}

export interface PendingIdentity {
  readonly userId: string
  readonly email: string
  readonly displayName: string | null
  readonly mustChangePassword: boolean
}

/** The half-finished sign-in this request belongs to, if there is one and it is still open. */
export const pendingOf = (req: Request, deps: HttpDeps): PendingSecondFactor | undefined => {
  const pending = (req.session as unknown as SessionPayload | undefined)?.pendingSecondFactor
  if (pending === undefined) return undefined
  return isStampFresh(
    pending.startedAt,
    deps.clock.now().getTime(),
    PENDING_SECOND_FACTOR_LIFETIME_MS,
  )
    ? pending
    : undefined
}
