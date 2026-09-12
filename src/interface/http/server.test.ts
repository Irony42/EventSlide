import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anEvent } from '../../application/testing/builders'
import { DomainError } from '../../domain/shared/errors'
import { CSRF_COOKIE, CSRF_HEADER } from './middleware/csrf'
import {
  anUnusableSessionStore,
  buildServerHarness,
  type ServerHarness,
} from './testing/serverHarness'

/**
 * What `buildServer()` decides, and nothing else: **the order the middleware runs in**.
 *
 * Every other HTTP test assembles its own `express()` app through `middlewareHarness`,
 * which is the right shape for asking "does this middleware answer correctly" and the
 * wrong shape for asking "is it mounted where it has to be". Order is where HTTP
 * security lives here:
 *
 * - CSRF is in front of every router, so no route can forget it.
 * - Health is in front of the body parser, the cookie parser and the session, because a
 *   probe is a machine with no cookie jar and must not be answered by way of the session
 *   store. That ordering *is* observable, and the test below observes it the only honest
 *   way: with a store whose every operation fails.
 * - The request id is attached before the body parser, so even a body the parser refuses
 *   can be correlated to a log line.
 * - The API 404 is in front of the SPA fallback. Note what that does **not** prove: the
 *   fallback carries its own `/api/` guard, so moving the 404 behind it still answers
 *   JSON. Mutating the mount order leaves this file green; it is the pair that holds the
 *   contract, and the 404 is what covers the methods `app.get('*')` never sees.
 * - The error handler is last, so everything above can throw into it.
 *
 * `buildServer` never calls `listen()`, which is what makes all of this reachable with
 * supertest and no open port.
 */

/** A marker only the built web app could contain, so "did the SPA answer" is decidable. */
const SPA_MARKER = '<div id="root" data-built-by="vite"></div>'
const HASHED_ASSET = 'assets/app.0a1b2c3d.js'

/**
 * `set-cookie` is the one header that can legitimately repeat, so Node gives it as an
 * array while supertest's types declare every header as a string. Narrowing through
 * `unknown` gets the real shape with no cast and no `any`.
 */
const setCookies = (headers: Readonly<Record<string, string>>): string[] => {
  const raw: unknown = headers['set-cookie']
  if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === 'string')
  return typeof raw === 'string' ? [raw] : []
}

/**
 * Any `GET` at all, used only to collect the CSRF cookie the way a browser does.
 *
 * `issueCsrfToken` is mounted app-wide, so every response carries the cookie — except a
 * probe, which is answered before the issuer runs. This is deliberately not `/api/health`
 * for that reason, and `/api/nope` because it needs nothing seeded to answer.
 */
const ANY_GET = '/api/nope'

const csrfTokenFrom = (headers: Readonly<Record<string, string>>): string => {
  const header = setCookies(headers).find((value) => value.startsWith(`${CSRF_COOKIE}=`))
  if (header === undefined) throw new Error('the server issued no CSRF cookie')
  const value = header.slice(`${CSRF_COOKIE}=`.length).split(';')[0]
  if (value === undefined || value.length === 0) throw new Error('the CSRF cookie was empty')
  return decodeURIComponent(value)
}

/** One directive out of a CSP, so a test can pin `script-src` without pinning the rest. */
const directive = (csp: string, name: string): string => {
  const found = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `))
  if (found === undefined) throw new Error(`the CSP has no ${name} directive: ${csp}`)
  return found
}

const csp = (headers: Readonly<Record<string, string>>): string => {
  const header = headers['content-security-policy']
  if (header === undefined) throw new Error('no Content-Security-Policy was set')
  return header
}

describe('buildServer: liveness and readiness', () => {
  it('serves liveness with no session, no cookie and no CSRF token', async () => {
    // A probe is a machine with no cookie jar. Health is mounted before the CSRF gate
    // and before every router for exactly this reason.
    const response = await request(buildServerHarness().app).get('/api/health')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ status: 'ok', version: '2.0.0-test' })
  })

  it('reports uptime from the injected clock, never from the wall clock', async () => {
    const subject = buildServerHarness()
    subject.clock.advance(90_000)

    const response = await request(subject.app).get('/api/health')

    expect(response.body.uptimeSeconds).toBe(90)
  })

  it('issues no session to a probe, so a projector refresh is not a slow leak', async () => {
    // `saveUninitialized: false`. 1.0's MemoryStore grew a row per anonymous visitor.
    const response = await request(buildServerHarness().app).get('/api/health')

    expect(setCookies(response.headers).some((value) => value.startsWith('es_session='))).toBe(
      false,
    )
  })

  it('serves liveness while the session store is unusable', async () => {
    // The ordering claim in `server.ts`, made observable. A monitoring tab that still
    // holds an `es_session` cookie would otherwise have its probe answered by way of the
    // store — so a locked or corrupt SQLite file would fail liveness for a reason
    // liveness is not about, and a 500 there is a restart that drops every in-flight
    // upload. Health is mounted ahead of `session(...)` precisely so the store is never
    // consulted.
    const subject = buildServerHarness({ sessionStore: anUnusableSessionStore() })

    const response = await request(subject.app)
      .get('/api/health')
      .set('Cookie', 'es_session=s%3Aa-stale-session-id.signature')

    expect(response.status).toBe(200)
  })

  it('serves readiness while the session store is unusable', async () => {
    // Readiness reports on the database and the media root. Reporting on the session
    // store as well — by accident, through the middleware above it — would take a
    // container out of service for a dependency this answer does not describe.
    const subject = buildServerHarness({ sessionStore: anUnusableSessionStore() })

    const response = await request(subject.app)
      .get('/api/ready')
      .set('Cookie', 'es_session=s%3Aa-stale-session-id.signature')

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('ready')
  })

  it('serves readiness with both dependencies healthy', async () => {
    const response = await request(buildServerHarness().app).get('/api/ready')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ready', checks: { database: 'ok', media: 'ok' } })
  })

  it('answers 503 naming the database when only the database is unavailable', async () => {
    // An orchestrator acts on this: which dependency failed decides whether the
    // container is restarted or taken out of service.
    const subject = buildServerHarness()
    subject.health.databaseReady = async () => false

    const response = await request(subject.app).get('/api/ready')

    expect(response.status).toBe(503)
    expect(response.body.error.details).toEqual({ database: 'unavailable', media: 'ok' })
  })

  it('answers 503 naming the media root when only the media root is unavailable', async () => {
    // A read-only volume: the container can still serve reads, and must stop accepting
    // uploads it cannot store.
    const subject = buildServerHarness()
    subject.health.mediaWritable = async () => false

    const response = await request(subject.app).get('/api/ready')

    expect(response.status).toBe(503)
    expect(response.body.error.details).toEqual({ database: 'ok', media: 'unavailable' })
  })

  it('answers with service.notReady rather than a 500 when a dependency is down', async () => {
    // A correct answer about an incorrect state. A 500 would read as "the app is
    // broken" and provoke a restart instead of a drain.
    const subject = buildServerHarness()
    subject.health.databaseReady = async () => false

    const response = await request(subject.app).get('/api/ready')

    expect(response.body.error.code).toBe('service.notReady')
  })

  it('treats a database check that throws as unavailable', async () => {
    // SQLite raising `SQLITE_BUSY` must not become a 500 from the probe itself.
    const subject = buildServerHarness()
    subject.health.databaseReady = async () => {
      throw new Error('SQLITE_BUSY')
    }

    const response = await request(subject.app).get('/api/ready')

    expect(response.status).toBe(503)
    expect(response.body.error.details.database).toBe('unavailable')
  })

  it('treats a media check that throws as unavailable', async () => {
    const subject = buildServerHarness()
    subject.health.mediaWritable = async () => {
      throw new Error('EROFS: read-only file system')
    }

    const response = await request(subject.app).get('/api/ready')

    expect(response.status).toBe(503)
    expect(response.body.error.details.media).toBe('unavailable')
  })
})

describe('buildServer: the CSRF gate in front of the routers', () => {
  it('refuses a state-changing request that does not echo the CSRF cookie', async () => {
    // Mounted on `/api` ahead of every router, so no individual route can forget it.
    const response = await request(buildServerHarness().app)
      .post('/api/join')
      .send({ joinCode: 'H7K2QM' })

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('request.csrfMissing')
  })

  it('lets a state-changing request reach its route once it echoes the CSRF cookie', async () => {
    // The body is deliberately empty: reaching the route's own schema — a 400 from zod
    // rather than a 403 from the gate — is what proves the gate opened.
    const subject = buildServerHarness()
    const agent = request.agent(subject.app)
    const first = await agent.get(ANY_GET)
    const token = csrfTokenFrom(first.headers)

    const response = await agent.post('/api/join').set(CSRF_HEADER, token).send({})

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('does not gate a safe method, so the wall and the join page stay public', async () => {
    const subject = buildServerHarness()
    subject.events.seed(anEvent({ slug: 'mariage', status: 'draft' }))

    const response = await request(subject.app).get('/api/events/mariage/wall')

    // A draft event is a 404 from `resolvePublicEvent`; the point is that it is not a
    // 403 from the CSRF gate.
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })
})

describe('buildServer: which client a rate limit is counting', () => {
  /**
   * `app.set('trust proxy', config.trustProxyHops)` is the only thing that decides which
   * address a limit counts, and it is set in `buildServer` — so nothing below the server
   * can assert it. One hop is the deployment this product has; a join limit of one makes
   * a single bucket visible in two requests.
   */
  const behindOneProxy = (): ServerHarness =>
    buildServerHarness({
      config: {
        trustProxyHops: 1,
        rateLimits: {
          joinPerMinute: 1,
          uploadPerMinute: 12,
          loginPerMinute: 10,
          reactionPerMinute: 30,
        },
      },
    })

  /**
   * One join attempt from one client. The body is deliberately invalid: the limiter runs
   * ahead of the route, so a 400 means "the bucket had room" and only the bucket is under
   * test here.
   */
  const join = async (subject: ServerHarness, forwardedFor: string): Promise<request.Response> => {
    const agent = request.agent(subject.app)
    const token = csrfTokenFrom((await agent.get(ANY_GET)).headers)
    return agent
      .post('/api/join')
      .set('X-Forwarded-For', forwardedFor)
      .set(CSRF_HEADER, token)
      .send({})
  }

  it('ignores an address the client itself prepended to X-Forwarded-For', async () => {
    // Trusting one hop too many is what makes a limit decorative: the leftmost entry is
    // written by whoever sent the request, so a script rotating it would never be
    // limited. Only the address the proxy appended may key the bucket.
    const subject = behindOneProxy()
    expect((await join(subject, '9.9.9.9, 203.0.113.7')).status).toBe(400)

    const second = await join(subject, '8.8.8.8, 203.0.113.7')

    expect(second.status).toBe(429)
    expect(second.body.error.code).toBe('rate.limited')
  })

  it('counts two clients behind the proxy apart, so one guest cannot lock out the venue', async () => {
    // The other failure of the same setting: with no hop trusted at all, every request
    // appears to come from the proxy and the first guest to burst closes the door on the
    // whole room.
    const subject = behindOneProxy()
    expect((await join(subject, '203.0.113.7')).status).toBe(400)

    const other = await join(subject, '203.0.113.8')

    expect(other.status).toBe(400)
  })
})

describe('buildServer: security headers on a real response', () => {
  it('sets a Content-Security-Policy that names no remote origin', async () => {
    // The policy is only this tight because 2.0 removed the CDN. This assertion is what
    // stops a remote `<script>` or web font coming back: adding one means editing this
    // test, which means saying out loud that the policy is being loosened.
    const response = await request(buildServerHarness().app).get('/api/health')

    expect(csp(response.headers)).not.toMatch(/https?:\/\//)
  })

  it('defaults every fetch directive to this origin', async () => {
    const response = await request(buildServerHarness().app).get('/api/health')

    expect(directive(csp(response.headers), 'default-src')).toBe("default-src 'self'")
  })

  it('allows no inline script in production', async () => {
    const response = await request(buildServerHarness({ config: { isProduction: true } }).app).get(
      '/api/health',
    )

    expect(directive(csp(response.headers), 'script-src')).toBe("script-src 'self'")
  })

  it("allows Vite's inline dev client outside production only", async () => {
    const response = await request(buildServerHarness().app).get('/api/health')

    expect(directive(csp(response.headers), 'script-src')).toBe("script-src 'self' 'unsafe-inline'")
  })

  it('allows a photo preview from a blob but a photo request from nowhere else', async () => {
    // `blob:` is the local preview the upload queue draws before sending; no remote
    // origin may supply an image, or an injected `<img>` becomes an exfiltration path.
    const response = await request(buildServerHarness().app).get('/api/health')

    expect(directive(csp(response.headers), 'img-src')).toBe("img-src 'self' data: blob:")
  })

  it('restricts where the page may connect to, so an injected script cannot exfiltrate', async () => {
    const response = await request(buildServerHarness().app).get('/api/health')

    expect(directive(csp(response.headers), 'connect-src')).toBe("connect-src 'self'")
  })

  it('refuses to be framed, so a projector left unattended cannot be clickjacked', async () => {
    const response = await request(buildServerHarness().app).get('/api/health')

    expect(directive(csp(response.headers), 'frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(response.get('x-frame-options')).toBe('DENY')
  })

  it('refuses content-type sniffing, which is how a stored file becomes stored XSS', async () => {
    const response = await request(buildServerHarness().app).get('/api/health')

    expect(response.get('x-content-type-options')).toBe('nosniff')
  })

  it('sends no referrer, so a join code cannot leak through one', async () => {
    const response = await request(buildServerHarness().app).get('/api/health')

    expect(response.get('referrer-policy')).toBe('no-referrer')
  })

  it('advertises no server stack', async () => {
    const response = await request(buildServerHarness().app).get('/api/health')

    expect(response.get('x-powered-by')).toBeUndefined()
  })

  it('denies the device permissions this app never asks for', async () => {
    // The camera is reached through a file input with `capture`, which needs no grant.
    const response = await request(buildServerHarness().app).get('/api/health')

    expect(response.get('permissions-policy')).toContain('geolocation=()')
  })

  it('pins HSTS in production', async () => {
    const response = await request(buildServerHarness({ config: { isProduction: true } }).app).get(
      '/api/health',
    )

    expect(response.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains')
  })

  it('sets no HSTS outside production, so localhost is not pinned to https', async () => {
    const response = await request(buildServerHarness().app).get('/api/health')

    expect(response.get('strict-transport-security')).toBeUndefined()
  })

  it('asks the browser to upgrade insecure requests in production', async () => {
    const response = await request(buildServerHarness({ config: { isProduction: true } }).app).get(
      '/api/health',
    )

    expect(csp(response.headers)).toContain('upgrade-insecure-requests')
  })

  it('does not upgrade insecure requests in development, where there is no https', async () => {
    const response = await request(buildServerHarness().app).get('/api/health')

    expect(csp(response.headers)).not.toContain('upgrade-insecure-requests')
  })
})

describe('buildServer: the error handler is last', () => {
  const throwingWall = (error: unknown): ServerHarness => {
    const subject = buildServerHarness({
      usecases: {
        getWallPlaylist: async () => {
          throw error
        },
      },
    })
    subject.events.seed(anEvent({ slug: 'mariage', status: 'live' }))
    return subject
  }

  it('translates a DomainError thrown past a route through the one status table', async () => {
    // Mapped by `STATUS_BY_KIND`, not chosen at the call site: 1.0 picked a status at
    // each of forty-odd sites and answered the same failure three different ways.
    const response = await request(
      throwingWall(DomainError.conflict('event.illegalTransition', { from: 'draft' })).app,
    ).get('/api/events/mariage/wall')

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('event.illegalTransition')
  })

  it('carries the details of a thrown DomainError and nothing else', async () => {
    const response = await request(
      throwingWall(DomainError.conflict('event.illegalTransition', { from: 'draft' })).app,
    ).get('/api/events/mariage/wall')

    expect(Object.keys(response.body)).toEqual(['error'])
    expect(response.body.error.details).toEqual({ from: 'draft' })
  })

  it('answers an unexpected throw with an opaque 500 that leaks no path', async () => {
    const response = await request(
      throwingWall(new Error('ENOENT: /var/data/eventslide.sqlite')).app,
    ).get('/api/events/mariage/wall')

    expect(response.status).toBe(500)
    expect(JSON.stringify(response.body)).not.toContain('/var/data')
  })

  it('refuses a body over the 64kb limit as a limit, not as a server fault', async () => {
    // `express.json({ limit: '64kb' })` rejects before any route runs. A 500 there would
    // tell a client whose request is simply too big that the server is broken, and
    // `unexpected` is the one kind docs/API.md defines as "a bug or an unavailable
    // dependency" — which a deliberate limit is not.
    const response = await request(buildServerHarness().app)
      .post('/api/join')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ joinCode: 'H7K2QM', displayName: 'x'.repeat(70_000) }))

    expect(response.status).toBe(413)
    expect(response.body.error.code).toBe('request.tooLarge')
  })

  it('refuses a body that is not JSON with the same code a zod failure uses', async () => {
    const response = await request(buildServerHarness().app)
      .post('/api/join')
      .set('Content-Type', 'application/json')
      .send('{not json')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('gives even a body rejected by the parser a request id to be found by', async () => {
    // `requestContext` is mounted ahead of `express.json` for this: the failure a client
    // is most likely to be arguing about is the one that must be correlatable to a log
    // line. Mounted the other way round, this answer carries an empty id and no header.
    const response = await request(buildServerHarness().app)
      .post('/api/join')
      .set('Content-Type', 'application/json')
      .send('{not json')

    expect(response.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('buildServer: the API 404 in front of the SPA fallback', () => {
  let clientDir: string

  /**
   * A stand-in for `dist/`. Built once for the file rather than per test because it is
   * immutable fixture data — nothing here writes to it, so there is nothing to leak
   * between tests.
   */
  beforeAll(async () => {
    clientDir = await mkdtemp(join(tmpdir(), 'eventslide-client-'))
    await mkdir(join(clientDir, 'assets'), { recursive: true })
    await writeFile(join(clientDir, 'index.html'), `<!doctype html>${SPA_MARKER}`, 'utf8')
    await writeFile(join(clientDir, HASHED_ASSET), 'console.log(1)\n', 'utf8')
    await writeFile(join(clientDir, 'favicon.svg'), '<svg/>\n', 'utf8')
  })

  afterAll(async () => {
    await rm(clientDir, { recursive: true, force: true })
  })

  const withClient = (isProduction = false): ServerHarness =>
    buildServerHarness({ config: { isProduction }, clientDir })

  it('answers an unknown /api path with a JSON 404 rather than the SPA shell', async () => {
    // Two mechanisms hold this, and it takes both: `apiNotFound` mounted ahead of the
    // fallback, and the fallback's own `/api/` guard. Removing either one alone leaves
    // this green — removing both returns `index.html` under a 200, and a client parsing
    // that as JSON fails confusingly.
    const response = await request(withClient().app).get('/api/nope')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('route.notFound')
  })

  it('answers an unknown /api path as JSON even for a state-changing method', async () => {
    const subject = withClient()
    const agent = request.agent(subject.app)
    const first = await agent.get(ANY_GET)

    const response = await agent
      .post('/api/nope')
      .set(CSRF_HEADER, csrfTokenFrom(first.headers))
      .send({})

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('route.notFound')
  })

  it('serves the SPA shell for a client route, so a hard refresh keeps working', async () => {
    // `/join/:code`, `/e/:slug/display` and `/admin/**` are client routes. A guest who
    // reloads the page they scanned into must not get a 404.
    const response = await request(withClient().app).get('/admin/events/evt-1/moderation')

    expect(response.status).toBe(200)
    expect(response.text).toContain(SPA_MARKER)
  })

  it('never caches the SPA shell, so a QR scan after a deploy cannot get stale assets', async () => {
    const response = await request(withClient().app).get('/join/H7K2QM')

    expect(response.get('cache-control')).toBe('no-cache')
  })

  it('never caches index.html when it is requested by name', async () => {
    // `express.static` serves this one, not the fallback, so it needs its own header.
    const response = await request(withClient().app).get('/index.html')

    expect(response.get('cache-control')).toBe('no-cache')
  })

  it('serves a content-hashed asset as immutable in production', async () => {
    const response = await request(withClient(true).app).get(`/${HASHED_ASSET}`)

    expect(response.status).toBe(200)
    expect(response.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  it('does not mark an unhashed file immutable, because its name can be reused', async () => {
    const response = await request(withClient(true).app).get('/favicon.svg')

    expect(response.get('cache-control')).not.toContain('immutable')
  })

  it('marks nothing immutable in development, where assets are rebuilt constantly', async () => {
    const response = await request(withClient().app).get(`/${HASHED_ASSET}`)

    expect(response.get('cache-control')).not.toContain('immutable')
  })
})
