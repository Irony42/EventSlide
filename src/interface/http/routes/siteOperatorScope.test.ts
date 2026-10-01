import type { IncomingMessage } from 'node:http'
import express, { type Express } from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import type {
  GetPhotoMediaInput,
  MediaViewer,
} from '../../../application/usecases/photos/getPhotoMedia'
import { AT, anEvent, aUser } from '../../../application/testing/builders'
import { DomainError } from '../../../domain/shared/errors'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { err } from '../../../domain/shared/result'
import { CSRF_HEADER } from '../middleware/csrf'
import { mountedRoutes, type Route } from '../testing/routeTable'
import { buildServerHarness, type ServerHarness } from '../testing/serverHarness'
import { anonymousCaller, signedInAs, signInByAddress, type Caller } from '../testing/signIn'
import { galleryHeaders } from './galleryRoutes'

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
 * reads — or, for the operator's own namespace, in {@link OPERATOR_ROUTES}, which is held
 * to a rule of its own. Sweeping by default rather than by a `:eventSlug` filter is
 * deliberate: filtering made "event-scoped" a property of how a route spells its
 * parameter, so one resolving its event from a photo row or a body field left the sweep
 * with nothing saying so. Every exemption list is itself exercised below, because a list
 * that removes a case is otherwise the cheapest way to make a failing sweep green.
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
  'get /api/gallery/:token':
    'the shared gallery (roadmap §4.1): the link’s token **is** the credential, and the ' +
    'use case decides everything with it — an operator holding no token gets the neutral ' +
    '404 every stranger gets, and one holding the token sees exactly what the host sent',
  'post /api/gallery/:token/unlock':
    'the gallery’s password, which is the second factor on top of the token and is ' +
    'answered by the token’s own rule',
  'get /api/gallery/:token/photos': 'the gallery’s grid, behind the same token',
  'get /api/gallery-media/:linkId/album.zip':
    'the gallery’s archive: a signed URL the gallery minted, re-checked against the link',
  'get /api/gallery-media/:linkId/:photoId/:variant':
    'one photograph of the gallery, by a signed URL the gallery minted, re-checked against ' +
    'the link and scoped by the link’s own event',
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

/**
 * The routes of the operator's own namespace, `/api/site` (roadmap §10.9), each with the
 * reason it exists.
 *
 * They are the one surface an operator is **meant** to reach, so the event sweep below
 * would fail on every one of them, and neither list above describes them: they are not
 * public, and "reaches no event" would be checked in a mode where they are not mounted at
 * all, where a stale-entry guard would have to be weakened to let them through. So they
 * are a list of their own, held per mode to the rule that is actually theirs:
 *
 * - `SITE_ADMIN=on` — every entry is a route `siteRoutes` carries, every route mounted under
 *   `/api/site` is an entry, and each one refuses a signed-in account that does not operate
 *   the box with `requireOperator`'s own 403.
 * - `SITE_ADMIN=off` — none of them is mounted, and nothing else under `/api/site` is
 *   either.
 *
 * **An entry is only good for a route on the `/api/site` mount** ({@link carriedBySite}),
 * because it takes that route out of the event sweep, and the gate that answers for it
 * instead is the one `siteRoutes` applies to its whole mount. Listing a route of any other
 * router here — an `/api/events/:eventSlug/…` route carrying a `requireOperator` of its own,
 * say — would have excused it from the sweep while it read a client's evening: its own 403
 * to a non-operator satisfies every rule above, and the operator it lets in is exactly who
 * the sweep exists to refuse. So the on-mode check reads the mount, not the name, and the
 * sweep excludes an entry only where it really sits on that mount.
 *
 * Each one is declared in `siteRoutes.ts`, below its router-level gate; no other router may
 * declare a path in the namespace, which {@link trespassersOn} holds. Empty today, because
 * the namespace carries no route yet: the first one adds its line here in the same diff.
 */
const OPERATOR_ROUTES: Readonly<Record<string, string>> = {}

/** Where `buildServer` mounts `siteRoutes`, the one router that may declare a route here. */
const SITE_NAMESPACE = '/api/site'

/**
 * Whether `siteRoutes` carries a route: whether the router a request for it enters first is
 * the one mounted at the namespace, and therefore whether `requireOperator` answers for it.
 */
const carriedBySite = (route: Route): boolean => route.mount === SITE_NAMESPACE

/** A path below the namespace that no route will ever claim, whatever lands there. */
const NEVER_A_SITE_ROUTE = `${SITE_NAMESPACE}/__never-a-route__`

/**
 * Whether a route's full path lies in the operator's namespace, read the way a request
 * reaches it rather than the way it happens to be spelled.
 *
 * **Case-insensitively**, because every router here is: `/SITE/x` answers `/api/site/x`.
 * **With repeated slashes collapsed**, because a double slash is how a request steps around
 * a mount: `GET /api//site/x` matches the `/api` mount, which hands its routers `/site/x`,
 * and does not match the `/api/site` mount at all. So a route written `/site/x` on a router
 * mounted at `/api` answers it without `requireOperator` ever running, and one written
 * `//site/x` answers `/api///site/x` the same way. Mounting `siteRoutes` first cannot help
 * with either — ordering only decides who meets a request that reaches the mount — which
 * is why the rule is on what may be declared rather than on where the gate sits.
 * **At a segment boundary**, as a mount point matches: `/api/site` and `/api/site/…` are
 * the namespace and `/api/sites` is not, which is also what `siteAdminMode.test.ts` asserts
 * of the running gate. This used to reserve every path that merely started with
 * `/api/site`, so that a pattern such as `/site*` was caught by its spelling; the walk now
 * refuses every pattern path before it gets here, which is what made the prefix
 * unnecessary — and it was wrong about `/api/sites`.
 * **With a `:parameter` standing for any segment**, because that is what it matches: a
 * route written `/:section/leak` on a router mounted at `/api` answers `/api/site/leak`
 * with `SITE_ADMIN=off` and `/api//site/leak` with it on, and never spells `site` at all.
 */
const inSiteNamespace = (path: string): boolean => {
  const segments = path
    .replace(/\/{2,}/g, '/')
    .toLowerCase()
    .split('/')
    .filter(Boolean)
  const namespace = SITE_NAMESPACE.split('/').filter(Boolean)
  return (
    segments.length >= namespace.length &&
    namespace.every((segment, i) => segments[i] === segment || segments[i]?.startsWith(':'))
  )
}

/**
 * Every route in the operator's namespace that `siteRoutes` does not carry, each named with
 * the router it came from.
 *
 * "Carries" is decided by {@link Route.mount}, the router mounted on the app: a router
 * nested inside `siteRoutes` is behind its gate wherever it is mounted there, and a router
 * mounted on the app at `/api` is behind no gate at all, whatever path its route spells.
 */
const trespassersOn = (app: Express): readonly string[] =>
  mountedRoutes(app)
    .filter((route) => inSiteNamespace(route.path) && !carriedBySite(route))
    .map((route) => `${route.method} ${route.path}, on the router mounted at "${route.mount}"`)

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
  token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  linkId: A_PHOTO,
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

/** Who the stub login signs in, by the address it is given. */
const ACCOUNTS: Readonly<Record<string, string>> = {
  'ops@example.test': OPERATOR,
  'mariee@example.test': CLIENT,
}

/**
 * Signed in as the operator, the account this whole sweep is about.
 *
 * The token it carries is the one the **login response** issued, never the one collected
 * before it — `signedInAs` says why, and the named test below is what keeps it that way.
 */
const signInAsOperator = (subject: ServerHarness): Promise<Caller> =>
  signedInAs(subject.app, 'ops@example.test')

type HarnessOverrides = NonNullable<Parameters<typeof buildServerHarness>[0]>

/**
 * The assembled server, in the `SITE_ADMIN` mode a block below names.
 *
 * Every case here runs in **both** modes (roadmap §10.9). The switch decides how much
 * surface exists and nothing about who may use it, so the one thing it must never do is
 * change a single answer this sweep gets — and with `SITE_ADMIN=on`, every route the
 * operator's namespace grows is enumerated here the day it is mounted and held to
 * {@link OPERATOR_ROUTES}' rule, as every other route is held to the sweep's.
 */
const buildOperatorHarness = (siteAdmin: boolean, overrides: HarnessOverrides = {}) =>
  buildServerHarness({
    ...overrides,
    config: { ...overrides.config, siteAdmin },
    usecases: {
      authenticateUser: signInByAddress(ACCOUNTS),
      ...overrides.usecases,
    },
  })

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
 * pass on the 404. `where` narrows the search, so an operator route is looked up only among
 * the routes `siteRoutes` carries.
 */
const routeNamed = (
  siteAdmin: boolean,
  name: string,
  where: (route: Route) => boolean = () => true,
): Route => {
  const route = mountedRoutes(buildOperatorHarness(siteAdmin).app).find(
    (candidate) => `${candidate.method} ${candidate.path}` === name && where(candidate),
  )
  if (route === undefined) throw new Error(`no route named "${name}" is mounted`)
  return route
}

/** A handler for a route that only has to exist, in the stack walk's own apps. */
const answer: express.RequestHandler = (_req, res) => {
  res.end()
}

describe('the stack walk', () => {
  it('reads each router’s own mount point, so a route under /api/site is swept where it answers', () => {
    // The guard on `mountPathOf`. Every router but one is mounted at `/api`, so the case
    // below that names four `/api/events` routes cannot tell a walk that reads the mount
    // point from one that assumes it — and the one that is not at `/api` carries no route
    // yet, so nothing else here would notice either until it did.
    const app = express()
    const site = express.Router()
    site.get('/clients', answer)
    app.use('/api/site', site)

    expect(mountedRoutes(app)).toEqual([
      { method: 'get', path: '/api/site/clients', mount: '/api/site' },
    ])
  })

  it('credits a nested router’s route to the router mounted on the app, whose gate it meets', () => {
    // The guard on `Route.mount`, which `trespassersOn` decides by. Were it the innermost
    // router's own mount point, a router nested inside `siteRoutes` would look like a
    // stranger to the namespace — and, the other way round, reading every mount point as
    // `/api/site` would clear any router at all.
    const app = express()
    const site = express.Router()
    const clients = express.Router()
    clients.get('/invitations', answer)
    site.use('/clients', clients)
    app.use('/api/site', site)
    const api = express.Router()
    api.get('/events', answer)
    app.use('/api', api)

    expect(mountedRoutes(app)).toEqual([
      { method: 'get', path: '/api/site/clients/invitations', mount: '/api/site' },
      { method: 'get', path: '/api/events', mount: '/api' },
    ])
  })

  it.each([
    '/site/whatever',
    '//site/whatever',
    '/SITE/whatever',
    '/site',
    '/:section/leak',
    '/:section',
  ])(
    'counts a route written %s on a router mounted at /api as claiming the operator’s namespace',
    (path) => {
      // The guard on `inSiteNamespace`, one spelling per row: the one a slip in the wrong
      // file produces, the double slash that walks around the `/api/site` mount, the case
      // Express ignores, the namespace's root, and a `:parameter` in the namespace's place,
      // which matches `site` as readily as anything else.
      const app = express()
      const api = express.Router()
      api.get(path, answer)
      app.use('/api', api)

      expect(trespassersOn(app)).toEqual([`get /api${path}, on the router mounted at "/api"`])
    },
  )

  it.each(['/sites', '/sites/whatever', '/siteadmin'])(
    'leaves a route written %s on a router mounted at /api outside the namespace, as the mount does',
    (path) => {
      // The namespace is `/api/site` and `/api/site/*`, at a segment boundary, because that
      // is what `app.use('/api/site', …)` matches — `siteAdminMode.test.ts` asserts the gate
      // leaves `/api/sites` to the API's own 404. Reserving the bare prefix would count an
      // unrelated `/api/sites` route as a trespasser on a namespace it never reaches.
      const app = express()
      const api = express.Router()
      api.get(path, answer)
      app.use('/api', api)

      expect(trespassersOn(app)).toEqual([])
    },
  )

  it.each([
    '/site*',
    '/(site)/leak',
    '/sit?e/leak',
    '/[s]ite/leak',
    '/s{1}ite/leak',
    String.raw`/sit\e/leak`,
    '/x|/site/leak',
    '/events/:slug+',
  ])(
    'refuses to guess what a route written %s matches, rather than reading its spelling',
    (path) => {
      // The guard on the walk's refusal of patterns. On a router mounted at `/api`, each of
      // the first seven reaches into the namespace on express 4.22.3 — all but the first
      // answer `GET /api//site/leak` — and a walk that read them as text would file every
      // one of them outside it: none of those six spells `/site`, and `/site*` is not `/site`
      // or `/site/…` at a segment boundary. `{1}` and `\` are the two a list of forbidden
      // characters let through, which is why the walk now accepts one known shape instead.
      // The last row is outside the namespace altogether, because the refusal is not about
      // the namespace: a pattern is a route no sweep here can place.
      const app = express()
      const api = express.Router()
      api.get(path, answer)
      app.use('/api', api)

      expect(() => mountedRoutes(app)).toThrow(`refuses to guess what the route path ${path}`)
    },
  )

  it.each(['/site/leak', '/events'])(
    'refuses to guess what a middleware mounted at %s inside a router answers',
    (path) => {
      // `router.use('/site/leak', h)` on a router mounted at `/api` answers
      // `GET /api//site/leak` with no route anywhere for a walk to read — and a middleware
      // at any other path can answer whatever lies under it just as silently. Nothing on
      // the layer says whether it only sets a header, so the walk does not guess.
      const app = express()
      const api = express.Router()
      api.use(path, answer)
      app.use('/api', api)

      expect(() => mountedRoutes(app)).toThrow('refuses to guess what the middleware "answer"')
    },
  )

  it('lets the gallery’s headers through at their paths, the one middleware named with a reason', () => {
    // The guard on the allow-list, and on its being keyed by identity: `galleryRoutes`
    // mounts `galleryHeaders` at two paths, and a walk that refused it would refuse the
    // real server in both modes.
    const app = express()
    const api = express.Router()
    api.use(['/gallery', '/gallery-media'], galleryHeaders)
    api.get('/gallery/:token', answer)
    app.use('/api', api)

    expect(mountedRoutes(app)).toEqual([
      { method: 'get', path: '/api/gallery/:token', mount: '/api' },
    ])
  })

  it('reads a middleware at the root of a router as the router’s own, as siteRoutes mounts its gate', () => {
    // `router.use(requireOperator(deps))` has no path of its own to reach anything by: it
    // runs for whatever the router is handed, which is what makes it a gate.
    const app = express()
    const site = express.Router()
    site.use((_req, _res, next) => next())
    site.get('/clients', answer)
    app.use('/api/site', site)

    expect(mountedRoutes(app)).toEqual([
      { method: 'get', path: '/api/site/clients', mount: '/api/site' },
    ])
  })

  it.each([
    [
      'on the app, at /api',
      (app: Express, sub: Express) => {
        app.use('/api', sub)
      },
    ],
    [
      'on the app, at its root',
      (app: Express, sub: Express) => {
        app.use(sub)
      },
    ],
    [
      'at the root of a router',
      (app: Express, sub: Express) => {
        const api = express.Router()
        api.use(sub)
        app.use('/api', api)
      },
    ],
  ])('refuses to guess what a sub-app mounted %s serves', (_where, mount) => {
    // A sub-app's routes answer `GET /api//site/leak` like any router's, from a stack this
    // walk cannot reach: `app.use` hides it behind Express's `mounted_app` wrapper.
    const app = express()
    const sub = express()
    sub.get('/site/leak', answer)
    mount(app, sub)

    expect(() => mountedRoutes(app)).toThrow('refuses to guess what a sub-app')
  })

  it('clears every route of the router mounted at /api/site, nested ones included', () => {
    const app = express()
    const site = express.Router()
    const clients = express.Router()
    clients.get('/invitations', answer)
    site.get('/clients', answer)
    site.use('/clients', clients)
    app.use('/api/site', site)

    expect(trespassersOn(app)).toEqual([])
  })
})

/**
 * The `SITE_ADMIN` modes the sweep runs in, by name only. `off` first: it is what every box
 * that never set the variable runs.
 *
 * Names, not `[name, boolean]` pairs: a pair can say `['on', false]`, and a block labelled
 * "on" would then sweep the server "off" builds and report it green under the wrong name.
 * Each block derives its boolean from its own label instead, so the two cannot disagree.
 */
const MODES = ['off', 'on'] as const

/** What `GET` of a path no route claims answers in each mode, read back by every block. */
const NAMESPACE_ANSWER: Readonly<
  Record<(typeof MODES)[number], { readonly status: number; readonly code: string }>
> = {
  off: { status: 404, code: 'route.notFound' },
  on: { status: 401, code: 'auth.required' },
}

describe('the SITE_ADMIN modes this sweep runs in', () => {
  it('names each mode of the switch exactly once', () => {
    // The guard on the table the blocks below are generated from. A table that named one
    // mode twice would run one sweep twice, each block agreeing with its own label, and
    // report the other mode green without ever building it.
    expect([...MODES].sort()).toEqual(['off', 'on'])
  })
})

describe.each(MODES)('with SITE_ADMIN=%s', (mode) => {
  const siteAdmin = mode === 'on'
  const operatorHarness = (overrides: HarnessOverrides = {}) =>
    buildOperatorHarness(siteAdmin, overrides)

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

    it('answers the operator’s namespace as this mode does, so the block sweeps the server it names', async () => {
      // The guard on this block's server. Every case here builds it through
      // `operatorHarness`, and a harness that dropped the mode, or a boolean derived wrongly
      // from the label, would sweep the same server under both names. So the answer is
      // keyed on the **label** this block reports, and read back off the one answer that
      // differs between the modes: the gate's 401 with the namespace mounted, the API's own
      // 404 without it. What this cannot see is a table naming one mode twice — each such
      // block agrees with its own label — which is the table-level case above.
      const response = await request(operatorHarness().app).get(NEVER_A_SITE_ROUTE)

      expect({ status: response.status, code: errorCodeOf(response) }).toEqual(
        NAMESPACE_ANSWER[mode],
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
      const { agent, csrf } = await signInAsOperator(subject)

      const response = await agent
        .patch('/api/events/gala/settings')
        .set(CSRF_HEADER, csrf)
        .send({})

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
      // The lists say different things — "public to everyone", "reaches no event" and "the
      // operator's own" — and a key in two of them would mean neither was checked against
      // what it claims.
      const keys = [
        ...Object.keys(PUBLIC_ROUTES),
        ...Object.keys(NOT_EVENT_SCOPED),
        ...Object.keys(OPERATOR_ROUTES),
      ]
      const claimed = keys.filter((key, index) => keys.indexOf(key) !== index)

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
        const route = routeNamed(siteAdmin, name)
        const subject = operatorHarness()
        seedClientEvent(subject)
        const { agent, csrf } = await signInAsOperator(subject)

        const response = await send(agent, route, csrf)

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
        const route = routeNamed(siteAdmin, name)
        const subject = operatorHarness()
        seedClientEvent(subject)
        const stranger = await anonymousCaller(subject.app)

        const status = await statusFor(send(stranger.agent, route, stranger.csrf))

        expect(AUTHORIZATION_REFUSALS.has(status)).toBe(false)
      },
    )
  })

  describe('the operator’s own namespace', () => {
    const nameOf = (route: Route): string => `${route.method} ${route.path}`
    const routeNames = (): readonly string[] => mountedRoutes(operatorHarness().app).map(nameOf)
    const namesUnderSite = (): readonly string[] =>
      mountedRoutes(operatorHarness().app)
        .filter((route) => inSiteNamespace(route.path))
        .map(nameOf)

    it('lets no router but the one mounted at /api/site declare a route in it', () => {
      // `buildServer` mounts `siteRoutes` first behind the CSRF gate, which puts
      // `requireOperator` ahead of every other router for a request that reaches the
      // `/api/site` mount. It does nothing for one that does not: `GET /api//site/x` matches
      // only the `/api` mount, whose routers are handed `/site/x`. So a route some later
      // edit writes as `/site/…` on `eventRoutes` answered anybody with this switch off, and
      // anybody who typed the extra slash with it on. What keeps the namespace the gate's is
      // this: no other router may declare a path in it at all, in either mode.
      expect(trespassersOn(operatorHarness().app)).toEqual([])
    })

    // Each case below holds in one mode, and is registered in both: `runIf` and `skipIf`
    // report it skipped in the other, so no case can quietly exist in one mode only — as
    // an `if (siteAdmin)` around `it` let it, by registering nothing at all in the other.
    it.runIf(siteAdmin)('lists no operator route that siteRoutes does not carry', () => {
      // Checked against the routes on the `/api/site` mount, not against every route the
      // server mounts. An entry takes its route out of the event sweep, so one naming a
      // route of any other router — `requireOperator` written on an event route, say —
      // excused a route that let the operator into a client's evening, and every other
      // case stayed green: its own 403 to a non-operator is exactly what the case below
      // asks for. It also still catches the stale entry that outlived its route and would
      // hand its reason to the next route to take that path.
      const carried = new Set(
        mountedRoutes(operatorHarness().app).filter(carriedBySite).map(nameOf),
      )

      expect(Object.keys(OPERATOR_ROUTES).filter((key) => !carried.has(key))).toEqual([])
    })

    it.runIf(siteAdmin)('lists every route mounted under /api/site as an operator route', () => {
      // The other direction. A route in the namespace that nobody listed is swept as if
      // it were event-scoped, and one that happened to answer the operator a 4xx would
      // pass that sweep while its own rule — refused to everybody else — went unasked.
      expect(namesUnderSite().filter((name) => !(name in OPERATOR_ROUTES))).toEqual([])
    })

    // `it.each` over an empty table registers zero cases, in either mode, and says nothing:
    // while `OPERATOR_ROUTES` is empty this line is not a skipped case but an absent one,
    // and the report lists no "refuses …" line at all. The first entry is what makes one
    // appear, so its absence from a green run today is expected, not a gap.
    it.runIf(siteAdmin).each(Object.keys(OPERATOR_ROUTES))(
      'refuses %s to a signed-in account that does not operate the box, with requireOperator’s 403',
      async (name) => {
        // The account most worth refusing: signed in, the owner of an evening on this
        // very box, and nothing at all on the box itself. A route declared above the gate
        // in `siteRoutes`, or on a router mounted ahead of it, lets them through; the gate
        // refuses them before the route is looked at, and says which role was missing —
        // which is also what tells its 403 from the CSRF gate's.
        const route = routeNamed(siteAdmin, name, carriedBySite)
        const subject = operatorHarness()
        seedClientEvent(subject)
        const { agent, csrf } = await signedInAs(subject.app, 'mariee@example.test')

        const response = await send(agent, route, csrf)

        expect(response.status).toBe(403)
        expect(response.body.error).toMatchObject({
          code: 'auth.forbidden',
          details: { required: 'operator' },
        })
      },
    )

    it.skipIf(siteAdmin)('mounts no operator route, because the namespace is not mounted', () => {
      const mounted = new Set(routeNames())

      expect(Object.keys(OPERATOR_ROUTES).filter((key) => mounted.has(key))).toEqual([])
    })

    it.skipIf(siteAdmin)(
      'mounts no route under /api/site at all, whichever router would carry it',
      () => {
        // Wider than the line above: a route nobody listed, on whatever router, would be a
        // namespace this mode promises does not exist.
        expect(namesUnderSite()).toEqual([])
      },
    )
  })

  describe('an operator on a client’s event', () => {
    /**
     * Every route the server mounts, less the exemption lists.
     *
     * Not `path.includes(':eventSlug')`: that made "event-scoped" a property of how a route
     * spells its parameter rather than of what it reaches, so a route resolving its event
     * from a photo row or a body field left the sweep silently. The default is now that a
     * route is swept, and taking one out is a line in one of the lists above with a reason
     * and a test of its own. {@link OPERATOR_ROUTES} are the operator's to reach by design,
     * and answer to their own rule in the block above instead — **only where `siteRoutes`
     * carries them**: an entry naming a route on any other mount excuses nothing, and that
     * route is swept like every other.
     *
     * Read at collection, because `it.each` names a case per route before any case runs —
     * and caught there, because the walk throws on a shape it refuses to guess at, and a
     * throw at collection aborts the whole file with no case named, the other mode's block
     * included. The first case below fails with that error instead, in each mode.
     */
    const table = ((): { readonly routes: readonly Route[]; readonly unreadable: unknown } => {
      try {
        return { routes: mountedRoutes(operatorHarness().app), unreadable: null }
      } catch (error) {
        return { routes: [], unreadable: error }
      }
    })()

    it('reads the whole route table before sweeping it', () => {
      if (table.unreadable !== null) throw table.unreadable
      expect(table.routes.length).toBeGreaterThan(0)
    })

    const scopedRoutes = table.routes.filter((route) => {
      const name = `${route.method} ${route.path}`
      return (
        PUBLIC_ROUTES[name] === undefined &&
        NOT_EVENT_SCOPED[name] === undefined &&
        !(carriedBySite(route) && OPERATOR_ROUTES[name] !== undefined)
      )
    })

    it.each(scopedRoutes.map((route): [string, Route] => [`${route.method} ${route.path}`, route]))(
      'is refused by %s, exactly as a stranger is',
      async (_name, route) => {
        const subject = operatorHarness()
        seedClientEvent(subject)
        const { agent, csrf } = await signInAsOperator(subject)

        const response = await send(agent, route, csrf)

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
})
