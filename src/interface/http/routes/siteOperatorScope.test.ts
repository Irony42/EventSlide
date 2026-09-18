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
 * server** — the same `buildServer()` the product runs — and every event-scoped route is
 * required to refuse an operator who is not a member of that event. A route added later
 * is in this sweep the day it is mounted, and an author who genuinely means it to be
 * public has to say so in {@link PUBLIC_ROUTES}, with a reason, in a diff somebody reads.
 *
 * The use cases behind these routes are the harness's `notWired` ones, which throw. That
 * is deliberate: a request that got *past* authorization answers 500 rather than a
 * plausible 200, so "the operator was let in" cannot hide inside a 4xx.
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
 */
const PUBLIC_ROUTES: Readonly<Record<string, string>> = {
  'get /api/events/:eventSlug/wall': 'the wall itself: a projector has no credential at all',
  'get /api/events/:eventSlug/stream':
    'the wall’s live updates, and public for the same reason the wall is',
  'get /api/events/:eventSlug/photos/:photoId/:variant':
    'the bytes of a published photo, which the public wall renders; the policy for every ' +
    'other status is `getPhotoMedia`’s, and the operator arrives there as a member of the public',
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
const withParameters = (path: string): string =>
  path
    .replace(':eventSlug', 'gala')
    .replace(':photoId', A_PHOTO)
    .replace(':guestId', A_PHOTO)
    .replace(':userId', CLIENT)
    .replace(':clipJobId', A_PHOTO)
    .replace(':variant', 'display')
    .replace(':kind', 'love')

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
 */
const signInAsOperator = async (subject: ServerHarness) => {
  const agent = request.agent(subject.app)
  const token = csrfTokenFrom((await agent.get(ANY_GET)).headers)
  await agent
    .post('/api/auth/login')
    .set(CSRF_HEADER, token)
    .send({ email: 'ops@example.test', password: 'peu-importe-ici' })
    .expect(200)
  return { agent, token }
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

  it('lists no public exception that is not a route', () => {
    // A stale entry in `PUBLIC_ROUTES` is an exemption that outlived the route it was
    // written for, and the next route to take that path would inherit it silently.
    const mounted = new Set(
      mountedRoutes(operatorHarness().app).map((route) => `${route.method} ${route.path}`),
    )

    expect(Object.keys(PUBLIC_ROUTES).filter((key) => !mounted.has(key))).toEqual([])
  })
})

describe('an operator on a client’s event', () => {
  const scopedRoutes = mountedRoutes(operatorHarness().app).filter(
    (route) =>
      route.path.includes(':eventSlug') &&
      PUBLIC_ROUTES[`${route.method} ${route.path}`] === undefined,
  )

  it.each(scopedRoutes.map((route): [string, Route] => [`${route.method} ${route.path}`, route]))(
    'is refused by %s, exactly as a stranger is',
    async (_name, route) => {
      const subject = operatorHarness()
      seedClientEvent(subject)
      const { agent, token } = await signInAsOperator(subject)

      const response = await send(agent, route, token)

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
