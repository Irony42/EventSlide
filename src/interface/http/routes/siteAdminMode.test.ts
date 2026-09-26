import type request from 'supertest'
import { describe, expect, it } from 'vitest'
import { AT, aUser } from '../../../application/testing/builders'
import { CSRF_HEADER } from '../middleware/csrf'
import { routersMeeting } from '../testing/routeTable'
import { buildServerHarness, type ServerHarness } from '../testing/serverHarness'
import {
  A_PATH_NOBODY_WROTE,
  anonymousCaller,
  setCookies,
  signedInAs,
  signInByAddress,
  type Caller,
} from '../testing/signIn'

/**
 * `SITE_ADMIN`, as the assembled server applies it (docs/ROADMAP.md §10.9).
 *
 * Two rules, one per mode, and they are different kinds of rule:
 *
 * - **Off, the operator's namespace does not exist.** Not "exists and refuses": every
 *   `/api/site` path answers exactly what a path nobody ever wrote answers, status, body
 *   and headers, so a solo install exposes no operator surface at all — not even a gate
 *   that refuses. That does not keep the mode secret: on, an anonymous request here gets
 *   a 401 where off gets a 404, and the public `features.siteAdmin` flag the roadmap plans
 *   will say so outright. What off promises is that there is nothing here to reach.
 * - **On, the namespace is `requireOperator`'s, as a whole.** The gate is applied at the
 *   router, not per route, so it is proven here on paths **no route claims**: a gate that
 *   answers for a path with nothing behind it can only be a gate on the namespace. An
 *   operator who gets past it on such a path falls through to the API's own 404, which is
 *   what makes the router a gate rather than an answer.
 *
 * The switch is not a security boundary and nothing here treats it as one — the
 * operator-scope sweep (`siteOperatorScope.test.ts`) runs in both modes for that. What
 * this file protects is how much surface exists.
 */

const OPERATOR = '11111111-1111-4111-8111-111111111111'
const HOST = '22222222-2222-4222-8222-222222222222'

/** Who the stub login signs in, by address. */
const ACCOUNTS: Readonly<Record<string, string>> = {
  'ops@example.test': OPERATOR,
  'hote@example.test': HOST,
}

/** A path nobody wrote: the reference every "off" answer is compared against. */
const UNKNOWN = A_PATH_NOBODY_WROTE

/** Supplied on every request, so `X-Request-Id` is one of the headers compared. */
const REQUEST_ID = 'site-admin-mode'

/**
 * A path under the namespace that no route will ever claim.
 *
 * Reserved by its spelling, so that it stays "a path nobody wrote" when the namespace
 * grows real routes: `/api/site/clients` served this purpose until roadmap §10.2 made it
 * the obvious name for one.
 */
const NEVER_A_SITE_ROUTE = '/api/site/__never-a-route__'

/** The mount point, its trailing-slash twin, and paths below it that no route claims. */
const SITE_PATHS = [
  '/api/site',
  '/api/site/',
  NEVER_A_SITE_ROUTE,
  `${NEVER_A_SITE_ROUTE}/at/any/depth`,
]

/**
 * Every method the gate has to refuse, because it is written for every method: a gate
 * spelled `router.get('*', …)` plus `router.post('*', …)` holds for the first two and
 * waves the other three through.
 */
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'
const METHODS: readonly Method[] = ['get', 'post', 'put', 'patch', 'delete']

const harness = (siteAdmin: boolean): ServerHarness => {
  const subject = buildServerHarness({
    config: { siteAdmin },
    usecases: { authenticateUser: signInByAddress(ACCOUNTS) },
  })
  subject.users.seed(
    aUser({ id: OPERATOR, email: 'ops@example.test', siteRole: 'operator' }),
    aUser({ id: HOST, email: 'hote@example.test' }),
  )
  return subject
}

const issue = (agent: request.Agent, method: Method, path: string): request.Test => {
  switch (method) {
    case 'get':
      return agent.get(path)
    case 'post':
      return agent.post(path).send({})
    case 'put':
      return agent.put(path).send({})
    case 'patch':
      return agent.patch(path).send({})
    case 'delete':
      return agent.delete(path)
  }
}

/** Every request carries a CSRF token the gate accepts, so no refusal below is the gate's. */
const send = (caller: Caller, method: Method, path: string): request.Test =>
  issue(caller.agent, method, path).set('x-request-id', REQUEST_ID).set(CSRF_HEADER, caller.csrf)

/**
 * Everything a client can observe about a response, less the one header that is a
 * function of the wall clock rather than of the route.
 *
 * The body is compared as **text**, byte for byte, not as parsed JSON. `Set-Cookie` is
 * kept, with its `Expires` normalised: a signed-in session is `rolling`, so every response
 * re-sends the cookie with an expiry computed from the second it was answered in.
 */
const observable = (response: request.Response) => ({
  status: response.status,
  body: response.text,
  headers: Object.fromEntries(
    Object.entries(response.headers)
      .filter(([name]) => name !== 'date')
      .map(([name, value]): [string, unknown] =>
        name === 'set-cookie'
          ? [
              name,
              setCookies(response.headers).map((cookie) =>
                cookie.replace(/Expires=[^;]+/i, 'Expires=<rolling>'),
              ),
            ]
          : [name, value],
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  ),
})

const errorOf = (response: request.Response): unknown =>
  (response.body as { error?: unknown }).error

describe('SITE_ADMIN=off: the operator namespace does not exist', () => {
  it.each(SITE_PATHS.flatMap((path) => METHODS.map((method): [Method, string] => [method, path])))(
    'answers %s %s exactly as a path nobody wrote, so a solo box exposes no operator surface',
    async (method, path) => {
      const subject = harness(false)
      const caller = await anonymousCaller(subject.app)

      const reference = await send(caller, method, UNKNOWN)
      const response = await send(caller, method, path)

      // Stated outright as well as by comparison, so that a change to `apiNotFound`
      // itself cannot make both sides wrong together and this still pass.
      expect(response.status).toBe(404)
      expect(errorOf(response)).toEqual({
        code: 'route.notFound',
        message: 'No such endpoint',
        details: {},
      })
      expect(observable(response)).toEqual(observable(reference))
    },
  )

  it('tells a signed-in operator nothing either, because the box never turned it on', async () => {
    // The account the namespace is for, on a box that did not ask for it. What it gets is
    // the API's 404, not a 403 that says "there is something here, and not for you yet".
    const subject = harness(false)
    const operator = await signedInAs(subject.app, 'ops@example.test')

    for (const method of METHODS) {
      const reference = await send(operator, method, UNKNOWN)
      const response = await send(operator, method, NEVER_A_SITE_ROUTE)

      expect(response.status).toBe(404)
      expect(observable(response)).toEqual(observable(reference))
    }
  })
})

describe('SITE_ADMIN=on: the whole namespace is behind requireOperator', () => {
  it.each(SITE_PATHS.flatMap((path) => METHODS.map((method): [Method, string] => [method, path])))(
    'refuses %s %s with 401 when there is no session at all',
    async (method, path) => {
      const subject = harness(true)
      const caller = await anonymousCaller(subject.app)

      const response = await send(caller, method, path)

      expect(response.status).toBe(401)
      expect(errorOf(response)).toMatchObject({ code: 'auth.required' })
    },
  )

  it.each(SITE_PATHS.flatMap((path) => METHODS.map((method): [Method, string] => [method, path])))(
    'refuses %s %s with 403 for a signed-in account that does not operate the box, though no route claims it',
    async (method, path) => {
      // No route claims any of these paths, so a 403 here can only come from a gate on the
      // namespace itself. A gate written per route would answer them with the API's 404,
      // and the first route to forget it would answer with its data.
      const subject = harness(true)
      const host = await signedInAs(subject.app, 'hote@example.test')

      const response = await send(host, method, path)

      expect(response.status).toBe(403)
      expect(errorOf(response)).toEqual({
        code: 'auth.forbidden',
        message: expect.any(String),
        details: { required: 'operator' },
      })
    },
  )

  it('refuses an operator whose account was switched off after they signed in', async () => {
    // The role is read from storage on the request that uses it, never from the session,
    // so the tab the operator already had open loses the namespace on its next request.
    const subject = harness(true)
    const operator = await signedInAs(subject.app, 'ops@example.test')
    subject.users.seed(
      aUser({ id: OPERATOR, email: 'ops@example.test', siteRole: 'operator', disabledAt: AT }),
    )

    const response = await send(operator, 'get', NEVER_A_SITE_ROUTE)

    expect(response.status).toBe(403)
    expect(errorOf(response)).toMatchObject({
      code: 'auth.forbidden',
      details: { required: 'operator' },
    })
  })

  it('fails closed with a 500 when the site role cannot be read, never falling through to a 404', async () => {
    // `requireOperator` hands a failed lookup to the error handler rather than to the next
    // layer. Falling through instead would answer this operator the API's 404 today, and
    // tomorrow hand whoever was asking to the routes below the gate with no role
    // established — the one answer a gate must never give when it could not ask.
    const subject = harness(true)
    const operator = await signedInAs(subject.app, 'ops@example.test')
    subject.users.siteRoleFor = async () => {
      throw new Error('SQLITE_BUSY: database is locked')
    }

    const response = await send(operator, 'get', NEVER_A_SITE_ROUTE)

    expect(response.status).toBe(500)
    expect(errorOf(response)).toMatchObject({ code: 'server.unexpected' })
  })

  it.each(METHODS)(
    'lets an operator through to the API’s own 404 on a %s no route claims, because the gate falls through',
    async (method) => {
      // The gate calls `next()` and the router has nothing to match, so the request
      // leaves it and meets `apiNotFound` — the same answer, header for header, that the
      // operator gets for any other path nobody wrote.
      const subject = harness(true)
      const operator = await signedInAs(subject.app, 'ops@example.test')

      const reference = await send(operator, method, UNKNOWN)
      const response = await send(operator, method, NEVER_A_SITE_ROUTE)

      expect(response.status).toBe(404)
      expect(errorOf(response)).toMatchObject({ code: 'route.notFound' })
      expect(observable(response)).toEqual(observable(reference))
    },
  )

  it.each(['/api/definitely-not-a-route', '/api/sites', '/api/siteadmin'])(
    'leaves %s to the API’s own 404, because the gate is the namespace’s and not the API’s',
    async (path) => {
      // A mount point matches at a `/` boundary, so the namespace is `/api/site` and
      // `/api/site/*`, and `/api/sites` is not in it — the boundary the structural check in
      // `siteOperatorScope.test.ts` draws too. Mounting the router at `/api` instead would
      // put every guest's upload behind the operator check, and this is the case that says so.
      const subject = harness(true)
      const caller = await anonymousCaller(subject.app)

      const response = await send(caller, 'get', path)

      expect(response.status).toBe(404)
      expect(errorOf(response)).toMatchObject({ code: 'route.notFound' })
    },
  )

  it('meets the operator gate before any other API router on a path in its namespace', () => {
    // `buildServer` mounts the namespace first among the routers behind the CSRF gate, so a
    // request that reaches the `/api/site` mount meets the operator check before any of the
    // `/api` routers sees it. That is all ordering can promise: `GET /api//site/x` never
    // reaches this mount, and the `/api` routers are handed it as `/site/x`. That no other
    // router declares such a path is a separate rule, held structurally in both modes by
    // `siteOperatorScope.test.ts`; this one is the order.
    const routers = routersMeeting(harness(true).app, NEVER_A_SITE_ROUTE)

    // The guard on the guard: the routers mounted on `/api` match this path too, so an
    // empty or single-entry list means the walk read nothing, not that the order is right.
    expect(routers.length).toBeGreaterThan(1)
    expect(routers[0]?.test('/api/events')).toBe(false)
  })
})

describe('SITE_ADMIN either way: the CSRF gate answers first', () => {
  type UnsafeMethod = Exclude<Method, 'get'>
  const UNSAFE: readonly UnsafeMethod[] = ['post', 'put', 'patch', 'delete']
  const MODES = ['off', 'on'] as const

  it.each(
    MODES.flatMap((mode) =>
      UNSAFE.map((method): [UnsafeMethod, (typeof MODES)[number]] => [method, mode]),
    ),
  )(
    'refuses a %s under /api/site that carries no CSRF token with the gate’s 403, with SITE_ADMIN=%s',
    async (method, mode) => {
      // docs/API.md says the namespace table applies only once the CSRF gate has let a
      // request through. So a state-changing request with no token is the gate's in both
      // modes: never the 404 of a namespace that is not mounted, never `requireOperator`'s
      // 401 — which is what either would answer if the namespace were mounted, or exempted,
      // ahead of the gate.
      const { agent } = await anonymousCaller(harness(mode === 'on').app)

      const response = await issue(agent, method, NEVER_A_SITE_ROUTE)

      expect(response.status).toBe(403)
      expect(errorOf(response)).toMatchObject({ code: 'request.csrfMissing' })
    },
  )
})
