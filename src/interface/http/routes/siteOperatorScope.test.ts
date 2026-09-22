import type { IncomingMessage } from 'node:http'
import type { Express } from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import type {
  GetPhotoMediaInput,
  MediaViewer,
} from '../../../application/usecases/photos/getPhotoMedia'
import { AT, anEvent, aUser } from '../../../application/testing/builders'
import { DomainError } from '../../../domain/shared/errors'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { err, ok } from '../../../domain/shared/result'
import { CSRF_COOKIE, CSRF_HEADER } from '../middleware/csrf'
import { buildServerHarness, type ServerHarness } from '../testing/serverHarness'

/**
 * What the box's operator can reach on a client's evening: **nothing**.
 *
 * This is the guard for the half of roadmap §10.1 that is dangerous. The role itself is
 * a column and a middleware; the promise is that a second, higher authority now exists
 * *without* any existing authorization check having widened by a single route. An
 * operator who could quietly moderate a client's photographs would be worse than one who
 * could not help at all — looking at someone's evening is §10.6, which ships time-boxed,
 * announced in the client's own interface and written to a log they can read.
 *
 * ## Why this enumerates the router instead of listing routes
 *
 * A hand-written list of paths is a guard that rots: the next event-scoped route is
 * covered by nothing, and nothing says so. So the route table is read off the **assembled
 * server** — the same `buildServer()` the product runs — and every route it mounts is
 * required to refuse an operator who is not a member of that event, unless it is named in
 * {@link PUBLIC_ROUTES} or {@link NOT_EVENT_SCOPED} with a reason, in a diff somebody
 * reads. Sweeping by default rather than by a `:eventSlug` filter is deliberate: filtering
 * made "event-scoped" a property of how a route spells its parameter, so one resolving its
 * event from a photo row or a body field left the sweep with nothing saying so. Both
 * exemption lists are themselves exercised below, because a list that removes a case is
 * otherwise the cheapest way to make a failing sweep green.
 *
 * The use cases behind these routes are the harness's `notWired` ones, which throw. That
 * is deliberate: a request that got *past* authorization answers 500 rather than a
 * plausible 200, so "the operator was let in" cannot hide inside a 4xx.
 *
 * ## The failure this file already had, and the guard that now stands on it
 *
 * The sweep was green on 18 mutating routes it was not exercising. `signInAsOperator`
 * returned a CSRF token collected from a GET issued **before** the login, and
 * `POST /api/auth/login` rotates that cookie in the same gesture as it regenerates the
 * session — so every POST, PATCH and DELETE here was answered `403 request.csrfMismatch`
 * by middleware mounted ahead of every router, and 403 satisfied the 4xx assertion. An
 * event-scoped route mounted with no authorization decision at all passed this sweep.
 * Two guards stand on it now: a named case for the credential itself, and a per-case
 * assertion that the refusal did not come from the CSRF gate.
 */

const OPERATOR = '11111111-1111-4111-8111-111111111111'
const CLIENT = '22222222-2222-4222-8222-222222222222'
const GALA = asEventId('evt-gala')
const A_PHOTO = '33333333-3333-4333-8333-333333333333'

/** Any `GET`, to collect the CSRF cookie the way a browser does. */
const ANY_GET = '/api/nope'

/**
 * The event-scoped routes that are public **by decision**, each with the reason.
 *
 * Every one of them is public to the whole internet, so an operator reaching it is not a
 * privilege — they are reading what the projector in the room reads. Anything not on this
 * list must refuse.
 *
 * An entry here removes a route from the sweep, which makes this the cheapest possible
 * way to silence a failure — so it is not taken on the word of the reason string.
 * `answers a caller with no credential at all` below drives every one of these with no
 * session and no device token and requires an answer that is not an authorization
 * refusal, so parking a guarded route here fails rather than hides.
 */
const PUBLIC_ROUTES: Readonly<Record<string, string>> = {
  'get /api/events/:eventSlug/wall': 'the wall itself: a projector has no credential at all',
  'get /api/events/:eventSlug/stream':
    'the same channel the wall opens, and the same handler behind it — `streamRoutes` ' +
    'mounts one `streamHandler` for both, so the frames are the moderator channel’s ' +
    'frames: every `photo.*`, `guest.*`, `event.*` and `clip.*` type on the event’s bus, ' +
    'moderation activity included. They carry a type and nothing else — no id, no caption, ' +
    'no bytes — so what the operator learns here is what anybody holding the slug learns, ' +
    'which is the ground for the exemption. That the moderator channel is therefore no ' +
    'more private than this one predates §10.1 and is not this sweep’s to fix',
  'get /api/events/:eventSlug/photos/:photoId/:variant':
    'the bytes of a published photo, which the public wall renders; the policy for every ' +
    'other status is `getPhotoMedia`’s, and the operator arrives there as a member of the public',
  'post /api/join':
    'the join code **is** the credential, and a guest arrives holding nothing else — the ' +
    'route reaches an event, by a body field rather than by the path, so it is classified ' +
    'here rather than as a route that touches no event at all',
}

/**
 * The routes that reach **no event at all**, each with the reason.
 *
 * The invariant this file states is "every event-scoped route refuses an operator who is
 * not a member", and *event-scoped* is a property of what a route reaches — not of how it
 * spells its parameter. Filtering the sweep on `path.includes(':eventSlug')` made it a
 * property of the spelling: a route resolving its event from `:eventId`, from a photo row,
 * from a clip job or from a body field dropped out of the sweep silently, and the list is
 * generated, so nobody read it to notice.
 *
 * So the default is inverted. Every route the server mounts is swept unless it is named
 * here or in {@link PUBLIC_ROUTES}, and both lists are checked below for still
 * corresponding to a mounted route and for the exemption actually holding. A new route is
 * covered the day it is mounted whatever it calls its event, and taking it out of the
 * sweep is a deliberate line in a diff somebody reads.
 */
const NOT_EVENT_SCOPED: Readonly<Record<string, string>> = {
  'get /api/health': 'liveness: the process is up, and it is the same answer for everyone',
  'get /api/ready': 'readiness: the database and the media root, which belong to no event',
  'post /api/auth/login': 'establishing a session is what one has instead of an event',
  'post /api/auth/logout': 'ending that session',
  'get /api/auth/me': 'who the caller is — the answer names no event',
  'post /api/auth/password': 'an account’s own password, which no event owns',
  'get /api/events':
    'the caller’s **own** dashboard: the membership table answers it, so an ' +
    'operator with no membership is shown nothing, which `tenant-isolation.spec.ts` asserts',
  'post /api/events':
    'creating an event, which by definition has no event to be scoped to — ' +
    'the creator becomes its owner, so it grants an operator nothing over anybody else’s',
}

interface Route {
  readonly method: string
  readonly path: string
}

/**
 * The properties of anything that has them, or `null`.
 *
 * Express's stack holds both plain layer objects and routers, and a router **is a
 * function** carrying a `stack` — so a `typeof === 'object'` guard walks past every
 * mounted router and finds nothing at all.
 */
const propertiesOf = (value: unknown): Record<string, unknown> | null =>
  (typeof value === 'object' && value !== null) || typeof value === 'function'
    ? (value as Record<string, unknown>)
    : null

/**
 * The routes the assembled app actually serves, read from Express's own layer stack.
 *
 * Narrowed from `unknown` at every step rather than cast: the stack is Express's
 * internal shape, and a version that changed it should fail this test loudly instead of
 * silently enumerating nothing — which would leave every assertion below vacuously true.
 */
const mountedRoutes = (app: Express): readonly Route[] => {
  const found: Route[] = []

  const walk = (stack: unknown, prefix: string): void => {
    if (!Array.isArray(stack)) return
    for (const layer of stack) {
      const properties = propertiesOf(layer)
      if (properties === null) continue

      const route = propertiesOf(properties['route'])
      if (route !== null && typeof route['path'] === 'string') {
        const methods = propertiesOf(route['methods'])
        if (methods === null) continue
        for (const [method, enabled] of Object.entries(methods)) {
          if (enabled === true) found.push({ method, path: `${prefix}${route['path']}` })
        }
        continue
      }

      // A mounted router. Every router in this product is mounted at `/api`, and
      // `server.ts` is the one file that says so.
      const handle = propertiesOf(properties['handle'])
      if (properties['name'] === 'router' && handle !== null) walk(handle['stack'], `${prefix}/api`)
    }
  }

  const router = propertiesOf((app as unknown as Record<string, unknown>)['_router'])
  walk(router?.['stack'], '')
  return found
}

/**
 * Issues the request a route describes.
 *
 * A `switch` rather than an index into the agent, so an unfamiliar method is a loud
 * failure rather than a `TypeError` two frames away — and so nothing here is cast.
 */
const send = (agent: request.Agent, route: Route, csrf: string): request.Test => {
  const path = withParameters(route.path)
  switch (route.method) {
    case 'get':
      return agent.get(path)
    case 'post':
      return agent.post(path).set(CSRF_HEADER, csrf)
    case 'patch':
      return agent.patch(path).set(CSRF_HEADER, csrf)
    case 'put':
      return agent.put(path).set(CSRF_HEADER, csrf)
    case 'delete':
      return agent.delete(path).set(CSRF_HEADER, csrf)
    default:
      throw new Error(`this sweep does not know how to issue a ${route.method} request`)
  }
}

/** Placeholder values for the parameters that are not the event. Never reached. */
const PARAMETERS: Readonly<Record<string, string>> = {
  eventSlug: 'gala',
  photoId: A_PHOTO,
  guestId: A_PHOTO,
  userId: CLIENT,
  clipJobId: A_PHOTO,
  missionId: A_PHOTO,
  variant: 'display',
  kind: 'love',
}

/**
 * Fills a route's parameters, and **throws on one it does not know**.
 *
 * The same discipline as the `switch` in {@link send}, and for a sharper reason since the
 * sweep stopped filtering on `:eventSlug`: an unknown parameter left in the path would be
 * requested literally, answered 404 because no such slug or id exists, and counted as a
 * refusal. The route would appear swept while nothing about its authorization was ever
 * exercised — a vacuous pass, which is the one failure this file exists to make
 * impossible.
 */
const withParameters = (path: string): string =>
  path.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    const value = PARAMETERS[name]
    if (value === undefined) {
      throw new Error(
        `this sweep has no placeholder for ":${name}" (in ${path}). Add one to PARAMETERS — ` +
          'requesting the path with the parameter still in it would 404 for the wrong reason ' +
          'and pass while asserting nothing.',
      )
    }
    return value
  })

const seedClientEvent = (subject: ServerHarness): void => {
  subject.events.seed(
    anEvent({ id: GALA, slug: 'gala', name: 'Gala', ownerId: CLIENT, status: 'live' }),
  )
  subject.memberships.seed({
    eventId: GALA,
    userId: asUserId(CLIENT),
    role: 'owner',
    grantedAt: AT,
  })
  subject.users.seed(
    aUser({ id: OPERATOR, email: 'ops@example.test', siteRole: 'operator' }),
    aUser({ id: CLIENT, email: 'mariee@example.test' }),
  )
}

/**
 * A login that establishes the operator's session without a password hasher.
 *
 * The session is the precondition here, not the subject: `authRoutes.test.ts` covers what
 * a real sign-in does. What matters below is that the caller is signed in *as the
 * operator*, which is the account this whole sweep is about.
 *
 * The returned token is the one the **login response** issued, never the one collected
 * from the GET before it. `POST /api/auth/login` calls `rotateCsrfToken` in the same
 * gesture as it regenerates the session — a token that survived a change of identity is a
 * token whose scope nobody can state — so the pre-login value is stale the moment the
 * login succeeds, and `requireCsrfToken` on `/api` refuses every unsafe method carrying
 * it before a single authorization middleware runs. A browser re-reads the cookie; so
 * does this. The named test above is what keeps it that way.
 */
const signInAsOperator = async (subject: ServerHarness) => {
  const agent = request.agent(subject.app)
  const issued = csrfTokenFrom((await agent.get(ANY_GET)).headers)
  const login = await agent
    .post('/api/auth/login')
    .set(CSRF_HEADER, issued)
    .send({ email: 'ops@example.test', password: 'peu-importe-ici' })
    .expect(200)
  return { agent, token: csrfTokenFrom(login.headers) }
}

const operatorHarness = (overrides: Parameters<typeof buildServerHarness>[0] = {}) =>
  buildServerHarness({
    ...overrides,
    usecases: {
      authenticateUser: async () =>
        ok({
          userId: asUserId(OPERATOR),
          email: 'ops@example.test',
          displayName: null,
          mustChangePassword: false,
        }),
      ...overrides.usecases,
    },
  })

const setCookies = (headers: Readonly<Record<string, string>>): string[] => {
  const raw: unknown = headers['set-cookie']
  return Array.isArray(raw) ? raw.map(String) : []
}

/** What `requireCsrfToken` answers, either way it can refuse. */
const CSRF_REFUSALS: ReadonlySet<string> = new Set(['request.csrfMismatch', 'request.csrfMissing'])

const errorCodeOf = (response: request.Response): string | null => {
  const body: unknown = response.body
  if (typeof body !== 'object' || body === null) return null
  const error: unknown = (body as Record<string, unknown>)['error']
  if (typeof error !== 'object' || error === null) return null
  const code: unknown = (error as Record<string, unknown>)['code']
  return typeof code === 'string' ? code : null
}

const refusedByTheCsrfGate = (response: request.Response): boolean => {
  const code = errorCodeOf(response)
  return code !== null && CSRF_REFUSALS.has(code)
}

/** What `middleware/authz` answers a caller it will not let through. */
const AUTHORIZATION_REFUSALS: ReadonlySet<number> = new Set([401, 403])

/**
 * The status line alone, read off the socket without waiting for the body.
 *
 * `GET /api/events/:eventSlug/stream` is a public route **and** a response that never
 * ends, and supertest resolves on `end`. So the one exemption whose public-ness is most
 * worth checking is the one an ordinary `await` cannot check at all. The status line is
 * the whole question here — "was this caller refused for want of a credential" — so the
 * request is abandoned the moment it arrives, which also means no test leaves an SSE
 * socket and a heartbeat interval behind it.
 */
const statusFor = (test: request.Test): Promise<number> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the server sent no status line')), 5_000)
    test.end(() => {})
    const underlying = (test as unknown as { readonly req: NodeJS.EventEmitter }).req
    underlying.on('response', (incoming: IncomingMessage) => {
      clearTimeout(timer)
      resolve(incoming.statusCode ?? 0)
      test.abort()
    })
  })

/**
 * The mounted route an exemption names, or a loud failure.
 *
 * `lists no exemption that is not a route` already refuses a stale key, but the two
 * `it.each` blocks below read a `Route` rather than a string and must not invent one: a
 * key nobody mounts would otherwise be exercised against a path that exists nowhere and
 * pass on the 404.
 */
const routeNamed = (name: string): Route => {
  const route = mountedRoutes(operatorHarness().app).find(
    (candidate) => `${candidate.method} ${candidate.path}` === name,
  )
  if (route === undefined) throw new Error(`no route named "${name}" is mounted`)
  return route
}

const csrfTokenFrom = (headers: Readonly<Record<string, string>>): string => {
  const header = setCookies(headers).find((value) => value.startsWith(`${CSRF_COOKIE}=`))
  if (header === undefined) throw new Error('the server issued no CSRF cookie')
  const value = header.slice(`${CSRF_COOKIE}=`.length).split(';')[0]
  if (value === undefined || value.length === 0) throw new Error('the CSRF cookie was empty')
  return decodeURIComponent(value)
}

describe('the route table this sweep covers', () => {
  it('finds the routes this is actually about', () => {
    // The guard on the guard. If the stack walk ever returns nothing — a new Express, a
    // renamed internal — every assertion below would pass by describing no routes at all,
    // which is the one failure a sweep like this cannot notice by itself. So it names the
    // four surfaces the invariant is about: the queue, the decision on one photograph,
    // the whole album, and the settings of somebody's evening.
    const names = mountedRoutes(operatorHarness().app).map(
      (route) => `${route.method} ${route.path}`,
    )

    expect(names).toEqual(
      expect.arrayContaining([
        'get /api/events/:eventSlug/moderation',
        'patch /api/events/:eventSlug/photos/:photoId/status',
        'get /api/events/:eventSlug/album.zip',
        'patch /api/events/:eventSlug/settings',
      ]),
    )
  })

  it('signs in with a token the CSRF gate still accepts, so the sweep reaches authorization', async () => {
    // The guard on the sweep's own credential, and the reason it exists is that the
    // sweep was silently vacuous without it.
    //
    // `POST /api/auth/login` rotates the CSRF cookie in the same gesture as it
    // regenerates the session, so a token read from a GET issued *before* the login is
    // stale the instant the login succeeds. `requireCsrfToken` is mounted on `/api`
    // ahead of every router, so a request echoing the stale value is answered
    // `403 request.csrfMismatch` by middleware that runs before `requireRole` — and 403
    // is a 4xx, so every mutating case below would pass while asserting nothing at all
    // about authorization. Measured: 18 of the sweep's cases died there.
    //
    // So this asserts the positive fact the sweep depends on: a mutating request from
    // the signed-in operator gets *past* the gate and is refused by authorization, on
    // authorization's own terms.
    const subject = operatorHarness()
    seedClientEvent(subject)
    const { agent, token } = await signInAsOperator(subject)

    const response = await agent.patch('/api/events/gala/settings').set(CSRF_HEADER, token).send({})

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })

  it('lists no exemption that is not a route', () => {
    // A stale entry in either list is an exemption that outlived the route it was
    // written for, and the next route to take that path would inherit it silently.
    const mounted = new Set(
      mountedRoutes(operatorHarness().app).map((route) => `${route.method} ${route.path}`),
    )
    const exemptions = [...Object.keys(PUBLIC_ROUTES), ...Object.keys(NOT_EVENT_SCOPED)]

    expect(exemptions.filter((key) => !mounted.has(key))).toEqual([])
  })

  it('exempts a route once, or not at all', () => {
    // The two lists say different things — "public to everyone" and "reaches no event" —
    // and a key in both would mean neither was checked against what it claims.
    const claimed = Object.keys(PUBLIC_ROUTES).filter((key) => key in NOT_EVENT_SCOPED)

    expect(claimed).toEqual([])
  })

  it.each(Object.entries(NOT_EVENT_SCOPED))(
    'reaches no event on %s, so leaving it out of the sweep exempts nothing',
    async (name) => {
      // The guard on the other exemption list. `NOT_EVENT_SCOPED` removes a route from
      // the sweep on the claim that there is no event behind it — so the claim is
      // checked against behaviour rather than taken from the reason string: a route that
      // resolves an event the operator has no part in answers `event.notFound`, which is
      // precisely what a route reaching no event cannot answer. Parking
      // `patch /api/events/:eventSlug/settings` here to silence a failure fails here
      // instead.
      const route = routeNamed(name)
      const subject = operatorHarness()
      seedClientEvent(subject)
      const { agent, token } = await signInAsOperator(subject)

      const response = await send(agent, route, token)

      expect(errorCodeOf(response)).not.toBe('event.notFound')
    },
  )

  it.each(Object.entries(PUBLIC_ROUTES))(
    'answers %s to a caller with no credential at all, which is what public means',
    async (name) => {
      // The guard on `PUBLIC_ROUTES`, and the reason it exists is that the list was
      // checked only for corresponding to a mounted route — never for the route being
      // public. That made a one-line addition with a plausible reason the cheapest way to
      // make a failing sweep case disappear, on the surface where a silenced failure
      // costs the most.
      //
      // So the exemption is exercised as what it claims: no session, no device token,
      // nothing but the CSRF token any GET hands out, so a 403 here is authorization's
      // and not the gate's. A genuinely public route answers something — 200, 404 for an
      // event that serves no wall, 400 for a body it did not get. A guarded one answers
      // 401 `auth.required` or 403 `auth.forbidden`, and says so here.
      const route = routeNamed(name)
      const subject = operatorHarness()
      seedClientEvent(subject)
      const stranger = request.agent(subject.app)
      const token = csrfTokenFrom((await stranger.get(ANY_GET)).headers)

      const status = await statusFor(send(stranger, route, token))

      expect(AUTHORIZATION_REFUSALS.has(status)).toBe(false)
    },
  )
})

describe('an operator on a client’s event', () => {
  /**
   * Every route the server mounts, less the two exemption lists.
   *
   * Not `path.includes(':eventSlug')`: that made "event-scoped" a property of how a route
   * spells its parameter rather than of what it reaches, so a route resolving its event
   * from a photo row or a body field left the sweep silently. The default is now that a
   * route is swept, and taking one out is a line in one of the lists above with a reason
   * and a test of its own.
   */
  const scopedRoutes = mountedRoutes(operatorHarness().app).filter((route) => {
    const name = `${route.method} ${route.path}`
    return PUBLIC_ROUTES[name] === undefined && NOT_EVENT_SCOPED[name] === undefined
  })

  it.each(scopedRoutes.map((route): [string, Route] => [`${route.method} ${route.path}`, route]))(
    'is refused by %s, exactly as a stranger is',
    async (_name, route) => {
      const subject = operatorHarness()
      seedClientEvent(subject)
      const { agent, token } = await signInAsOperator(subject)

      const response = await send(agent, route, token)

      // The refusal has to come from authorization, not from the CSRF gate mounted
      // ahead of every router. A sweep whose token has gone stale is answered 403 on
      // every unsafe method before `requireRole` runs, and 403 satisfies the range
      // below — which is exactly how this sweep once reported green on 18 routes it was
      // not exercising. Asserted per case rather than once, because the failure is
      // per-method: the GETs stay genuine while the mutating half goes blind.
      expect(refusedByTheCsrfGate(response)).toBe(false)

      // 4xx: which one is each route's own business — `requireRole` answers 404 so that
      // the operator cannot even confirm the event exists, `requireGuest` answers 401 for
      // a caller with no device token. What this asserts is the part that is the same
      // everywhere: never a 2xx, and never a 5xx, which is what a request that reached a
      // `notWired` use case would answer.
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.status).toBeLessThan(500)
    },
  )

  it('is told nothing by the moderation queue, the one screen this item is about', async () => {
    const subject = operatorHarness()
    seedClientEvent(subject)
    const { agent } = await signInAsOperator(subject)

    const response = await agent.get('/api/events/gala/moderation')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })

  it('reaches a photograph’s bytes as a member of the public, never as a moderator', async () => {
    // The media path resolves its own viewer rather than sitting behind `requireRole`,
    // because a projector with no credential has to be able to read the wall. So it is
    // the second place a site role could be mistaken for standing inside an event, and
    // the assertion is on what the use case was actually handed: `public`, which is what
    // decides that a pending photograph stays unreadable.
    const viewers: MediaViewer[] = []
    const subject = operatorHarness({
      usecases: {
        getPhotoMedia: async (input: GetPhotoMediaInput) => {
          viewers.push(input.viewer)
          return err(DomainError.notFound('photo.notFound'))
        },
      },
    })
    seedClientEvent(subject)
    const { agent } = await signInAsOperator(subject)

    await agent.get(`/api/events/gala/photos/${A_PHOTO}/display`).expect(404)

    expect(viewers).toEqual([{ kind: 'public' }])
  })
})
