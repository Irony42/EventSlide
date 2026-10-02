import type { Express } from 'express'
import request from 'supertest'
import { mountedRoutes } from './routeTable'

/**
 * The log canary sweep (P4-06 / docs/SECURITY.md R-13): call every mounted route with a
 * gallery token, a join code, a slug, a caption, an email, a password and a cookie —
 * canary values placed in the path, the query, the headers and the body — and prove no
 * log line written while the sweep ran contains any of them.
 *
 * It proves the rule by construction, not by assertion against a single route: the
 * values below are distinctive enough (`SENTINEL`-style) that finding one anywhere in
 * captured output is conclusive, and `mountedRoutes` is the same route-table reader
 * `siteOperatorScope.test.ts` sweeps with, so a route added to the server is swept the
 * moment it is mounted, with nothing here to remember to update.
 */

export const CANARY = {
  galleryToken: 'canary-gallery-token-9f3e1a7c4b2d6e81',
  joinCode: 'CNR7K2',
  slug: 'canary-slug-9f3e1a7c4b2d',
  caption: 'a canary caption 9f3e1a7c4b2d, never to be logged',
  email: 'canary-9f3e1a7c@example.test',
  password: 'canary-password-9f3e1a7c4b2d6e81',
  cookie: 'canary-cookie-value-9f3e1a7c4b2d6e81',
} as const

/** Every canary value, for a test to check none of them survived into a log line. */
export const CANARY_VALUES: readonly string[] = Object.values(CANARY)

/** Which canary a path parameter's own name suggests, so `:eventSlug` gets the slug one. */
const canaryForParam = (name: string): string => {
  const lower = name.toLowerCase()
  if (lower.includes('token')) return CANARY.galleryToken
  if (lower.includes('code')) return CANARY.joinCode
  return CANARY.slug
}

/** `/api/events/:eventSlug/photos` → `/api/events/canary-slug-.../photos`. */
const concretePath = (pattern: string): string =>
  pattern.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_whole, name: string) =>
    encodeURIComponent(canaryForParam(name)),
  )

const QUERY = `token=${encodeURIComponent(CANARY.galleryToken)}&code=${encodeURIComponent(CANARY.joinCode)}&slug=${encodeURIComponent(CANARY.slug)}`

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const
type HttpMethod = (typeof HTTP_METHODS)[number]
const isHttpMethod = (value: string): value is HttpMethod =>
  (HTTP_METHODS as readonly string[]).includes(value)

const MUTATING = new Set<HttpMethod>(['post', 'put', 'patch', 'delete'])

export interface LogCanarySweepResult {
  /** How many mounted routes the sweep actually called — a sweep of zero proves nothing. */
  readonly requestCount: number
}

/**
 * Calls every route `mountedRoutes(app)` finds, each with the full canary set. Awaits
 * each request in turn rather than in parallel, so that a response finishing — and
 * whatever it logs on the way — happens before the next request starts; a parallel
 * sweep would still be a valid attack, but it would make a failure harder to attribute
 * to one route.
 *
 * Deliberately asks nothing about the responses: a 400, a 401, a 404 or a 500 all still
 * exercise the access log and whatever the route's own handler logs on the way, which is
 * the only thing this sweep is about. It does not obtain a session or a CSRF token, so a
 * state-changing route is exercised up to its CSRF/authorization gate rather than deep
 * into its handler — the deeper cases are what `pinoLogger.test.ts`'s redaction suite
 * already covers directly.
 */
export const fireLogCanarySweep = async (app: Express): Promise<LogCanarySweepResult> => {
  const routes = mountedRoutes(app)

  for (const route of routes) {
    if (!isHttpMethod(route.method)) {
      throw new Error(`the log canary sweep does not know the HTTP method "${route.method}"`)
    }
    const path = concretePath(route.path)
    // Two statements: prettier would put `[route.method]` at the start of a line in one
    // chain, which `no-unexpected-multiline` rejects.
    const started = request(app)[route.method](`${path}?${QUERY}`)
    const call = started
      .set('Cookie', `es_session=${CANARY.cookie}`)
      .set('X-Canary-Email', CANARY.email)
      .set('X-Canary-Password', CANARY.password)

    if (MUTATING.has(route.method)) {
      await call
        .send({ caption: CANARY.caption, email: CANARY.email, password: CANARY.password })
        .catch(() => undefined)
    } else {
      await call.catch(() => undefined)
    }
  }

  return { requestCount: routes.length }
}
