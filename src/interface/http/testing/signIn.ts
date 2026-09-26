import type { Express } from 'express'
import request from 'supertest'
import type { AuthenticateUser } from '../../../application/usecases/auth/authenticateUser'
import { DomainError } from '../../../domain/shared/errors'
import { asUserId } from '../../../domain/shared/ids'
import { err, ok } from '../../../domain/shared/result'
import { CSRF_COOKIE, CSRF_HEADER } from '../middleware/csrf'

/**
 * Signing in against the assembled server, for suites whose subject is **who** is asking
 * rather than how a sign-in works — `authRoutes.test.ts` covers that.
 *
 * Shared by `siteOperatorScope.test.ts` and `siteAdminMode.test.ts`, which each carried a
 * copy, and the copies had already drifted: the sweep's `setCookies` dropped a
 * `Set-Cookie` that arrived as a single string, where the other one read it.
 */

/** A path nobody wrote: any `GET` of it hands out the CSRF cookie, as every `GET` does. */
export const A_PATH_NOBODY_WROTE = '/api/definitely-not-a-route'

/** Every `Set-Cookie` a response carries, whether it arrived as one string or as a list. */
export const setCookies = (headers: Readonly<Record<string, unknown>>): string[] => {
  const raw = headers['set-cookie']
  if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === 'string')
  return typeof raw === 'string' ? [raw] : []
}

/** The CSRF token a response issued, or a loud failure. */
export const csrfTokenFrom = (headers: Readonly<Record<string, unknown>>): string => {
  const header = setCookies(headers).find((value) => value.startsWith(`${CSRF_COOKIE}=`))
  if (header === undefined) throw new Error('the server issued no CSRF cookie')
  const value = header.slice(`${CSRF_COOKIE}=`.length).split(';')[0]
  if (value === undefined || value.length === 0) throw new Error('the CSRF cookie was empty')
  return decodeURIComponent(value)
}

/**
 * An `authenticateUser` that signs in whichever account the address names, with no
 * password hasher: the session is the precondition in these suites, not the subject, so a
 * test chooses who is asking by the address it logs in with.
 */
export const signInByAddress =
  (accounts: Readonly<Record<string, string>>): AuthenticateUser =>
  async ({ email }) => {
    const userId = accounts[email]
    if (userId === undefined) return err(DomainError.unauthenticated('auth.invalidCredentials'))
    return ok({ userId: asUserId(userId), email, displayName: null, mustChangePassword: false })
  }

export interface Caller {
  readonly agent: request.Agent
  /** A CSRF token the gate accepts, so a refusal a test reads is never the gate's. */
  readonly csrf: string
}

/** No session, but holding the CSRF cookie already, so no later response sets a fresh one. */
export const anonymousCaller = async (app: Express): Promise<Caller> => {
  const agent = request.agent(app)
  const csrf = csrfTokenFrom((await agent.get(A_PATH_NOBODY_WROTE)).headers)
  return { agent, csrf }
}

/**
 * Signed in as the account behind `email`, with the token **the login response** issued.
 *
 * Never the one collected from the `GET` before it. `POST /api/auth/login` calls
 * `rotateCsrfToken` in the same gesture as it regenerates the session — a token that
 * survived a change of identity is a token whose scope nobody can state — so the
 * pre-login value is stale the moment the login succeeds, and `requireCsrfToken` on `/api`
 * refuses every unsafe method carrying it before a single authorization middleware runs.
 * A browser re-reads the cookie; so does this. `siteOperatorScope.test.ts` fell into
 * exactly that trap once, and its sweep was green on 18 routes it was not exercising.
 */
export const signedInAs = async (app: Express, email: string): Promise<Caller> => {
  const { agent, csrf: beforeLogin } = await anonymousCaller(app)
  const login = await agent
    .post('/api/auth/login')
    .set(CSRF_HEADER, beforeLogin)
    .send({ email, password: 'peu-importe-ici' })
    .expect(200)
  return { agent, csrf: csrfTokenFrom(login.headers) }
}
