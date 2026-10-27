import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AT, aGuest, anEvent, aUser } from '../../application/testing/builders'
import { CapturingLogger } from '../../application/testing/capturingLogger'
import { DomainError } from '../../domain/shared/errors'
import {
  makeListModerators,
  type ListModerators,
} from '../../application/usecases/events/listModerators'
import { asEventId, asUserId } from '../../domain/shared/ids'
import { err, ok } from '../../domain/shared/result'
import { GUEST_COOKIE } from './middleware/authz'
import { CSRF_COOKIE, CSRF_HEADER } from './middleware/csrf'
import {
  anUnusableSessionStore,
  buildServerHarness,
  type ServerHarness,
} from './testing/serverHarness'
import { signedInAs, signInByAddress } from './testing/signIn'

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
 *   contract, and the 404 is what covers the methods the `/{*splat}` fallback never sees.
 * - The error handler is last, so everything above can throw into it.
 *
 * `buildServer` never calls `listen()`, which is what makes all of this reachable with
 * supertest and no open port.
 */

/** A marker only the built web app could contain, so "did the SPA answer" is decidable. */
const SPA_MARKER = '<div id="root" data-built-by="vite"></div>'
const HASHED_ASSET = 'assets/index-Bm0-ak5a.js'
/** What sits inside a dot-directory of the client folder, and must never be served. */
const HIDDEN_FILE_CONTENT = 'a file nobody asked to publish\n'

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

/**
 * One POST of exactly these bytes, over a socket this call opens and closes.
 *
 * supertest serialises whatever it is handed under a JSON content type, so it cannot send a
 * compressed body whose type is `application/json`: it would send the buffer's JSON
 * description instead of the buffer.
 */
const postRaw = async (
  app: Parameters<typeof http.createServer>[1],
  path: string,
  body: Buffer,
  headers: Readonly<Record<string, string>>,
): Promise<{ readonly status: number; readonly body: unknown }> => {
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('the server has no port')
    return await new Promise((resolve, reject) => {
      const outgoing = http.request(
        {
          port: address.port,
          host: '127.0.0.1',
          method: 'POST',
          path,
          headers: { ...headers, 'Content-Length': String(body.length) },
        },
        (incoming) => {
          const chunks: Buffer[] = []
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
          incoming.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8')
            resolve({ status: incoming.statusCode ?? 0, body: JSON.parse(text) as unknown })
          })
        },
      )
      outgoing.on('error', reject)
      outgoing.end(body)
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
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
    expect(response.body).toEqual({
      status: 'ready',
      // `video` and `disk` are reported and never acted on: a photo wall with no
      // encoder still serves the room, and a tight disk margin is already a refusal at
      // the upload itself (G3-06 / P4-10) — neither must take a venue's wall out of
      // service.
      checks: {
        database: 'ok',
        media: 'ok',
        video: 'ok',
        disk: { sufficient: true },
      },
    })
  })

  it('answers 503 naming the database when only the database is unavailable', async () => {
    // An orchestrator acts on this: which dependency failed decides whether the
    // container is restarted or taken out of service.
    const subject = buildServerHarness()
    subject.health.databaseReady = async () => false

    const response = await request(subject.app).get('/api/ready')

    expect(response.status).toBe(503)
    expect(response.body.error.details).toEqual({
      database: 'unavailable',
      media: 'ok',
      video: 'ok',
      disk: { sufficient: true },
    })
  })

  it('answers 503 naming the media root when only the media root is unavailable', async () => {
    // A read-only volume: the container can still serve reads, and must stop accepting
    // uploads it cannot store.
    const subject = buildServerHarness()
    subject.health.mediaWritable = async () => false

    const response = await request(subject.app).get('/api/ready')

    expect(response.status).toBe(503)
    expect(response.body.error.details).toEqual({
      database: 'ok',
      media: 'unavailable',
      video: 'ok',
      disk: { sufficient: true },
    })
  })

  it('answers 200 with disk reported insufficient, never 503, because an upload refusal is not a service state', async () => {
    // The point of G3-06 / P4-10: a tight disk margin is a client-facing 413 at the
    // upload itself, never a reason to take the whole box out of service.
    const subject = buildServerHarness()
    subject.health.diskSpace = async () => ({ sufficient: false, freeBytes: 1_000 })

    const response = await request(subject.app).get('/api/ready')

    expect(response.status).toBe(200)
    expect(response.body.checks.disk).toEqual({ sufficient: false })
  })

  describe("the exact free bytes are the operator's, not the public's (HTTP-L-12)", () => {
    // `GET /api/ready` is unauthenticated: the exact free bytes of the disk the albums live on let an
    // anonymous caller watch an event fill the box. The route says sufficient or not; the margin is a log line.
    const FREE = 42_949_672_960

    const probed = async (
      status: { readonly sufficient: boolean; readonly freeBytes: number | null },
      break_?: (subject: ReturnType<typeof buildServerHarness>) => void,
    ) => {
      const logger = new CapturingLogger()
      const subject = buildServerHarness({ logger })
      subject.health.diskSpace = async () => status
      break_?.(subject)
      const response = await request(subject.app).get('/api/ready')
      return { response, logger }
    }

    it('keeps the number out of a 200, whatever it is', async () => {
      const { response } = await probed({ sufficient: true, freeBytes: FREE })

      expect(response.status).toBe(200)
      expect(JSON.stringify(response.body)).not.toContain('freeBytes')
      expect(JSON.stringify(response.body)).not.toContain(String(FREE))
    })

    it('keeps the number out of a 503 as well', async () => {
      const { response, logger } = await probed(
        { sufficient: true, freeBytes: FREE },
        (subject) => {
          subject.health.databaseReady = async () => false
        },
      )

      expect(response.status).toBe(503)
      expect(JSON.stringify(response.body)).not.toContain('freeBytes')
      expect(JSON.stringify(response.body)).not.toContain(String(FREE))
      // Every probe logs it, the failing ones included: a box that cannot reach its database is
      // still a box whose margin the operator wants to know.
      expect(logger.find('readiness: free disk space')?.context).toEqual({
        sufficient: true,
        freeBytes: FREE,
      })
    })

    it('writes the number to the log at debug while there is room', async () => {
      const { logger } = await probed({ sufficient: true, freeBytes: FREE })

      const line = logger.find('readiness: free disk space')
      expect([line?.level, line?.context]).toEqual(['debug', { sufficient: true, freeBytes: FREE }])
    })

    it('writes it as a warning the moment the margin is too thin, which is the line an operator wants', async () => {
      const { response, logger } = await probed({ sufficient: false, freeBytes: 1_000 })

      expect(response.body.checks.disk).toEqual({ sufficient: false })
      const line = logger.find('readiness: free disk space')
      expect([line?.level, line?.context]).toEqual([
        'warn',
        { sufficient: false, freeBytes: 1_000 },
      ])
    })

    it('warns for a disk that could not be read, with a null where the number would be', async () => {
      // The case with no number at all, which is the one an operator most needs to hear about.
      const { logger } = await probed({ sufficient: false, freeBytes: null })

      const line = logger.find('readiness: free disk space')
      expect([line?.level, line?.context]).toEqual(['warn', { sufficient: false, freeBytes: null }])
    })
  })

  it('answers disk unreadable rather than throwing when the probe itself rejects', async () => {
    const subject = buildServerHarness()
    subject.health.diskSpace = async () => {
      throw new Error('ENOENT')
    }

    const response = await request(subject.app).get('/api/ready')

    expect(response.status).toBe(200)
    expect(response.body.checks.disk).toEqual({ sufficient: false })
  })

  it('warns, with no number, when the probe itself rejects', async () => {
    const logger = new CapturingLogger()
    const subject = buildServerHarness({ logger })
    subject.health.diskSpace = async () => {
      throw new Error('ENOENT')
    }

    await request(subject.app).get('/api/ready')

    const line = logger.find('readiness: free disk space')
    expect([line?.level, line?.context]).toEqual(['warn', { sufficient: false, freeBytes: null }])
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

  it('answers 503 once a shutdown has begun, even with both dependencies healthy', async () => {
    // P4-06 / docs/ARCHITECTURE.md "Graceful shutdown": SIGTERM flips this before
    // anything else, so an orchestrator stops sending new traffic ahead of the
    // connections it is about to lose — the database and the media root being fine is
    // not the question once this is true.
    const subject = buildServerHarness()
    subject.health.isShuttingDown = () => true

    const response = await request(subject.app).get('/api/ready')

    expect(response.status).toBe(503)
    expect(response.body.error.code).toBe('service.notReady')
  })

  it('does not wait on the database or the media root once shutting down', async () => {
    // The whole point of checking first: a probe during a shutdown must not be stuck
    // behind a dependency this process is about to stop caring about.
    const subject = buildServerHarness()
    subject.health.isShuttingDown = () => true
    let probed = false
    subject.health.databaseReady = async () => {
      probed = true
      return true
    }

    await request(subject.app).get('/api/ready')

    expect(probed).toBe(false)
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

  it('gates accepting an invitation too: it creates an account and starts a session', async () => {
    // Mounted after the CSRF gate on purpose, and pinned here on the assembled server: a route
    // that created accounts and sessions without the token would be a login-CSRF vector.
    const response = await request(buildServerHarness().app)
      .post('/api/invitations/any-token/accept')
      .send({ password: 'une phrase de passe 2026', displayName: 'Camille' })

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('request.csrfMissing')
  })

  it('leaves the preview of an invitation public, since reading it changes nothing', async () => {
    const response = await request(buildServerHarness().app).get('/api/invitations/any-token')

    // The harness wires no use case behind it, so the point is what is not here: a 403 from
    // the CSRF gate on a read.
    expect(response.status).not.toBe(403)
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
          guestWritePerMinute: 300,
          galleryPerMinute: 60,
          galleryMediaPerMinute: 600,
          galleryUnlockPerClient: 10,
          galleryUnlockPerLink: 50,
          eventCreationPerHour: 20,
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

  it('spends one upload allowance across photos and clips, not one each', async () => {
    // `express-rate-limit` mints a fresh `MemoryStore` per instance, so a
    // `uploadLimiter(...)` call inside each router was two independent allowances and a
    // guest could send `UPLOAD_RATE_LIMIT_PER_MINUTE` photographs *and* as many clips.
    // `buildServer` is the only place that can hold the one instance, so this is the
    // only ring that can see it. Both limiters run ahead of `requireGuest`, so a 401
    // means "the bucket had room" and only the bucket is under test.
    const subject = buildServerHarness({
      config: {
        rateLimits: {
          joinPerMinute: 10,
          uploadPerMinute: 1,
          loginPerMinute: 10,
          reactionPerMinute: 30,
          guestWritePerMinute: 300,
          galleryPerMinute: 60,
          galleryMediaPerMinute: 600,
          galleryUnlockPerClient: 10,
          galleryUnlockPerLink: 50,
          eventCreationPerHour: 20,
        },
      },
    })
    const agent = request.agent(subject.app)
    const token = csrfTokenFrom((await agent.get(ANY_GET)).headers)
    const spend = (path: string): request.Test =>
      agent.post(`/api/events/mariage/${path}`).set(CSRF_HEADER, token).send()

    expect((await spend('photos')).status).toBe(401)

    const clip = await spend('clips')

    expect(clip.status).toBe(429)
    expect(clip.body.error.code).toBe('rate.limited')
  })

  it('shares one upload concurrency slot across photos and clips, not one each (G3-06)', async () => {
    // The same defect shape as the rate-limiter test above, one layer down: a
    // `uploadConcurrencyLimiter(...)` call inside each router would be two independent
    // counters wearing one configuration name. `buildServer` is the only place that can
    // hold the one instance, so this is the only ring that can see it.
    //
    // Proving it needs a request genuinely held open — unlike a per-minute bucket, a
    // concurrency slot releases the moment a request finishes, so two sequential,
    // fully-awaited calls would prove nothing. `uploadPhotos` is stubbed to hang until
    // this test releases it, which is what keeps the first request's slot spent while
    // the second arrives.
    let releaseUpload: (() => void) | undefined
    const subject = buildServerHarness({
      config: {
        uploads: { maxBytes: 25_000_000, maxFiles: 20, maxConcurrentRequests: 1 },
      },
      usecases: {
        uploadPhotos: () =>
          new Promise((resolve) => {
            releaseUpload = () => resolve({ ok: false, error: DomainError.invalid('test.cleanup') })
          }),
      },
    })
    subject.events.seed(anEvent({ slug: 'mariage' }))
    subject.guests.seed(aGuest({ id: 'guest-1', eventId: 'event-1' }))
    const guestToken = subject.issueGuestToken('event-1', 'guest-1')

    // A real listener this test owns and closes itself, rather than one of the
    // ephemeral servers `request(app)` spins up per call: the first request below is
    // deliberately held open past the end of the second, and an ephemeral server
    // supertest never closes would leak a bound port into every test that runs after
    // this one — measured: it did, as `EADDRINUSE` several tests later.
    const server = http.createServer(subject.app)
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

      const probe = await request(server).get(ANY_GET)
      const csrfToken = csrfTokenFrom(probe.headers)
      const csrfCookie = setCookies(probe.headers).find((value) =>
        value.startsWith(`${CSRF_COOKIE}=`),
      )
      if (csrfCookie === undefined) throw new Error('the server issued no CSRF cookie')
      const cookieHeader = `${csrfCookie.split(';')[0]}; ${GUEST_COOKIE}=${guestToken}`

      // Fired with `.end()`, not awaited: a bare `request(server).post(...)` never
      // reaches the server at all unless something has already called `.end()` on it,
      // and this one is never going to resolve until `releaseUpload` runs below.
      const first = new Promise<request.Response>((resolve, reject) => {
        request(server)
          .post('/api/events/mariage/photos')
          .set('Cookie', cookieHeader)
          .set(CSRF_HEADER, csrfToken)
          .attach('photos', Buffer.from('one'), 'one.jpg')
          .end((error, response) => (error ? reject(error) : resolve(response)))
      })
      await expect.poll(() => releaseUpload !== undefined).toBe(true)

      const second = await request(server)
        .post('/api/events/mariage/clips')
        .set('Cookie', cookieHeader)
        .set(CSRF_HEADER, csrfToken)
        .attach('clip', Buffer.from('clip-bytes'), 'clip.mp4')

      expect(second.status).toBe(429)
      expect(second.body.error.code).toBe('upload.busy')

      releaseUpload?.()
      await first
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
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

  it.each([
    ['gzip', (body: string) => gzipSync(body)],
    ['br', (body: string) => brotliCompressSync(body)],
  ])(
    'bounds a %s body by what it inflates to, so a small request cannot carry a large one',
    async (encoding, compress) => {
      // The limit is on the *inflated* body. A compressed one that is tiny on the wire and
      // large once read is the cheap way past a size limit, and Express 5 reads brotli as
      // well as gzip and deflate (Express 4 refused `br` outright), so the second codec is
      // a second road to the same place. Both must end at the same 413.
      const bomb = compress(
        JSON.stringify({ joinCode: 'H7K2QM', displayName: 'x'.repeat(200_000) }),
      )
      expect(bomb.length).toBeLessThan(2_000)

      const answered = await postRaw(buildServerHarness().app, '/api/join', bomb, {
        'Content-Type': 'application/json',
        'Content-Encoding': encoding,
      })

      expect(answered.status).toBe(413)
      expect(answered.body).toMatchObject({ error: { code: 'request.tooLarge' } })
    },
  )
})

describe('buildServer: a request that carries no body still has an empty one', () => {
  it.each([
    ['no body and no content type', undefined],
    ['a body of a type the JSON parser does not read', 'text/plain'],
    ['a form, which this API does not take', 'application/x-www-form-urlencoded'],
  ] as const)(
    'names the missing field of a join request with %s, as the contract shows',
    async (_label, contentType) => {
      // docs/API.md §1 shows `"details": { "fields": "joinCode" }` for exactly this
      // request. Express 5 leaves `req.body` undefined where Express 4 left `{}`, and an
      // undefined body fails the schema once at the root and names no field at all.
      const subject = buildServerHarness()
      const agent = request.agent(subject.app)
      const first = await agent.get(ANY_GET)
      const post = agent.post('/api/join').set(CSRF_HEADER, csrfTokenFrom(first.headers))

      const response = await (contentType === undefined
        ? post
        : post.set('Content-Type', contentType).send('x=1'))

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('request.invalid')
      expect(response.body.error.details).toEqual({ fields: 'joinCode' })
    },
  )

  it('lets a body-less request reach a route whose body is optional, as on Express 4', async () => {
    // `shareLinkBody` is every-field-optional, so `{}` is a link with the defaults and a
    // client that sends nothing means the same. `undefined` is not an object, and the
    // schema refuses it: without the empty body this request is a 400 `request.invalid`
    // and the use case is never asked.
    const OWNER = '11111111-1111-4111-8111-111111111111'
    let asked = false
    const subject = buildServerHarness({
      usecases: {
        authenticateUser: signInByAddress({ 'host@example.test': OWNER }),
        createShareLink: async () => {
          asked = true
          return err(DomainError.invalid('test.theUseCaseWasAsked'))
        },
      },
    })
    subject.users.seed(aUser({ id: OWNER, email: 'host@example.test' }))
    subject.events.seed(anEvent({ id: 'evt-1', slug: 'mariage', ownerId: OWNER, status: 'live' }))
    subject.memberships.seed({
      eventId: asEventId('evt-1'),
      userId: asUserId(OWNER),
      role: 'owner',
      grantedAt: AT,
    })
    const { agent, csrf } = await signedInAs(subject.app, 'host@example.test')

    const response = await agent.post('/api/events/mariage/share-link').set(CSRF_HEADER, csrf)

    expect(asked).toBe(true)
    expect(response.body.error.code).toBe('test.theUseCaseWasAsked')
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
    await mkdir(join(clientDir, '.hidden'), { recursive: true })
    await writeFile(join(clientDir, '.hidden', 'secret.txt'), HIDDEN_FILE_CONTENT, 'utf8')
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

  it('serves the SPA shell at the root of the site, which a wildcard needs braces to reach', async () => {
    // `/*splat` needs at least one character after the slash; `/{*splat}` is the spelling
    // that also answers `/`. The host's first request to the box is this one.
    const response = await request(withClient().app).get('/')

    expect(response.status).toBe(200)
    expect(response.text).toContain(SPA_MARKER)
  })

  it('refuses to serve what sits in a dot-directory of the client folder', async () => {
    // Express 4 looked only at the last segment of the path and served this; Express 5
    // refuses it by default, and the option is spelled out in `server.ts` so that neither
    // version's default is what holds. It falls through to the shell, as any unknown path.
    const response = await request(withClient().app).get('/.hidden/secret.txt')

    expect(response.text).not.toContain(HIDDEN_FILE_CONTENT)
    expect(response.text).toContain(SPA_MARKER)
  })

  it('never caches the SPA shell, so a QR scan after a deploy cannot get stale assets', async () => {
    const response = await request(withClient().app).get('/join/H7K2QM')

    expect(response.get('cache-control')).toBe('no-cache')
  })

  it.each([
    ['the link’s own address', `/g/${'Q'.repeat(43)}`],
    ['a path below it', `/g/${'Q'.repeat(43)}/anything/at/all`],
    ['the bare prefix', '/g'],
  ])(
    'serves the shared gallery page at %s with no referrer, no index and no cache',
    async (_label, path) => {
      // The token is in this address (roadmap §4.1), so the page itself carries what every
      // gallery API response carries — and `no-store`, not the shell's `no-cache`. Two
      // patterns hold it, `/g` and `/g/*splat`, and a wildcard that is not named is not a
      // wildcard on Express 5: dropping either leaves its paths to the generic fallback
      // below, which is the shell without any of these headers.
      const response = await request(withClient().app).get(path)

      expect(response.status).toBe(200)
      expect(response.text).toContain(SPA_MARKER)
      expect(response.get('cache-control')).toBe('no-store')
      expect(response.get('x-robots-tag')).toBe('noindex, nofollow')
      expect(response.get('referrer-policy')).toBe('no-referrer')
    },
  )

  it.each([
    ['an invitation', '/invite/' + 'Q'.repeat(43)],
    ['a password reset', '/password/reset/' + 'Q'.repeat(43)],
    ['an invitation, in capitals, which Express routes the same', '/INVITE/' + 'Q'.repeat(43)],
    ['a reset, in capitals', '/Password/Reset/' + 'Q'.repeat(43)],
    ['an invitation with a trailing slash', '/invite/' + 'Q'.repeat(43) + '/'],
  ])(
    'serves the page of %s with no referrer, no index and no cache, like the gallery',
    async (_name, path) => {
      // The token is in this address (G2-10), so the page carries what the gallery's does:
      // `no-store`, not the shell's `no-cache`, and nothing that lets it be indexed.
      const response = await request(withClient().app).get(path)

      expect(response.status).toBe(200)
      expect(response.text).toContain(SPA_MARKER)
      expect(response.get('cache-control')).toBe('no-store')
      expect(response.get('x-robots-tag')).toBe('noindex, nofollow')
      expect(response.get('referrer-policy')).toBe('no-referrer')
    },
  )

  it.each(['/password/forgot', '/login', '/invite' + 'x'])(
    'leaves %s, which carries no token, an ordinary client route',
    async (path) => {
      const response = await request(withClient().app).get(path)

      expect(response.status).toBe(200)
      expect(response.get('cache-control')).toBe('no-cache')
      expect(response.get('x-robots-tag')).toBeUndefined()
    },
  )

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

describe('buildServer: Cache-Control defaults to no-store under /api (HTTP-M-15)', () => {
  /**
   * "Every principal-scoped read in this API says so explicitly" was false for five host reads, among them the
   * moderators' **e-mail addresses**: each route had to remember the header, and the next would forget. The
   * default is `server.ts`'s; a route that wants caching says so over it (the media route, the streams).
   */
  const OWNER = '11111111-1111-4111-8111-111111111111'

  it('marks an answer nobody wrote a route for', async () => {
    const response = await request(buildServerHarness().app).get('/api/nope')

    expect(response.status).toBe(404)
    expect(response.get('cache-control')).toBe('no-store')
  })

  it('marks the answers given before any router runs, whatever the method: a probe, a refused body, a refused write', async () => {
    // The default sits ahead of the probes, the body parser, the session and the CSRF gate. Mounted
    // after any of them, the answer that gate gives (a 400 for a body the parser refuses, a 403 for a
    // write without its token) went out with no header, and so did the probes.
    const subject = buildServerHarness()
    const agent = request.agent(subject.app)
    const token = csrfTokenFrom((await agent.get(ANY_GET)).headers)

    const answers = {
      health: await agent.get('/api/health'),
      malformedBody: await agent
        .post('/api/auth/login')
        .set(CSRF_HEADER, token)
        .set('Content-Type', 'application/json')
        .send('{not json'),
      writeWithoutToken: await agent.post('/api/join').send({}),
      patchWithoutToken: await agent.patch('/api/events/mariage/caption').send({}),
    }

    expect(answers.malformedBody.status).toBe(400)
    expect(answers.writeWithoutToken.status).toBe(403)
    expect(
      Object.fromEntries(
        Object.entries(answers).map(([name, response]) => [name, response.get('cache-control')]),
      ),
    ).toEqual({
      health: 'no-store',
      malformedBody: 'no-store',
      writeWithoutToken: 'no-store',
      patchWithoutToken: 'no-store',
    })
  })

  it('marks the host reads that set no header of their own: the event list and the moderators with their addresses', async () => {
    // The moderators come from the real use case, over the harness's own memberships.
    const listing: { current?: ListModerators } = {}
    const subject = buildServerHarness({
      usecases: {
        authenticateUser: signInByAddress({ 'host@example.test': OWNER }),
        listEventsForHost: async () => ok([]),
        listModerators: async (input) => {
          if (listing.current === undefined) throw new Error('listModerators was not built yet')
          return listing.current(input)
        },
      },
    })
    listing.current = makeListModerators({ memberships: subject.memberships })
    subject.users.seed(aUser({ id: OWNER, email: 'host@example.test' }))
    subject.events.seed(anEvent({ id: 'evt-1', slug: 'mariage', ownerId: OWNER, status: 'live' }))
    subject.memberships.seed({
      eventId: asEventId('evt-1'),
      userId: asUserId(OWNER),
      role: 'owner',
      grantedAt: AT,
    })
    const { agent } = await signedInAs(subject.app, 'host@example.test')

    const events = await agent.get('/api/events')
    const moderators = await agent.get('/api/events/mariage/moderators')

    expect(events.status).toBe(200)
    expect(events.get('cache-control')).toBe('no-store')
    expect(moderators.status).toBe(200)
    expect(JSON.stringify(moderators.body)).toContain('host@example.test')
    expect(moderators.get('cache-control')).toBe('no-store')
  })
})
