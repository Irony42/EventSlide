import { EventEmitter } from 'node:events'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import express, {
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Logger } from '../../../application/ports/logger'
import type { UserId } from '../../../domain/shared/ids'
import { asUserId } from '../../../domain/shared/ids'
import type { UserPrincipal } from '../types'
import { SECOND_FACTOR_FAILURES_PER_ACCOUNT } from '../../../domain/users/secondFactor'
import {
  eventCreationLimiter,
  galleryLimiter,
  galleryMediaLimiter,
  galleryUnlockLimiters,
  guestWriteLimiter,
  invitationIssueLimiter,
  invitationLimiter,
  joinLimiter,
  loginLimiter,
  passwordResetLimiter,
  reactionLimiter,
  secondFactorAccountLimiter,
  secondFactorLimiter,
  streamConnectionLimiter,
  uploadBodyDeadline,
  uploadConcurrencyLimiter,
  uploadLimiter,
} from './rateLimit'

/** A logger nobody reads: these tests are about keying, never about what gets logged. */
const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => noopLogger,
}

/**
 * How a rate-limit bucket is **keyed**, which is the part that decides whether a limit
 * is a limit at all.
 *
 * The status code and the error code are pinned by the route tests that own those
 * endpoints (`authRoutes`, `publicRoutes`, `guestRoutes`). What nothing else asserts is
 * the keying, and two of these were real defects:
 *
 * - A raw IPv6 address as the key. A residential allocation is routinely a /64, so one
 *   client holds 2^64 addresses and a per-address limit bounds nothing. `ipKeyGenerator`
 *   collapses the address to its subnet before it becomes a key.
 * - A per-IP-only key on uploads. A whole table of guests at a wedding shares one access
 *   point and therefore one public address, so the venue would be throttled rather than
 *   an abuser; the event is part of the key, and the byte quota is what bounds a
 *   determined guest.
 */

/** Two addresses a single household would hold, inside one /56. */
const SAME_SUBNET = ['2001:db8:1:2::1', '2001:db8:1:2:ffff::9'] as const
/** A different /56 — a different customer. */
const OTHER_SUBNET = '2001:db8:1:200::1'

const noContent: RequestHandler = (_req, res) => {
  res.status(204).end()
}

/**
 * An app that trusts exactly one proxy hop, so `X-Forwarded-For` is what `req.ip`
 * reports — the deployment this product actually has, and the only way a test can
 * present two different client addresses.
 */
const behindOneProxy = (mount: (app: Express) => void): Express => {
  const app = express()
  app.set('trust proxy', 1)
  mount(app)
  return app
}

/**
 * Every 429 a limiter writes has the error shape and a `Retry-After` (HTTP-M-04, HTTP-M-14).
 *
 * docs/API.md section 1 says every `rateLimited` sets the header, and seven limiters used to write
 * the status and the body themselves; the header came from `express-rate-limit` for most and from
 * nowhere for the stream's per-client cap. Walked over **every** limiter this module exports, so
 * the next one is a line in this list or a red case, not a client that retries at once.
 */
describe('every limiter answers 429 with the error shape and a Retry-After', () => {
  const withContext: RequestHandler = (req, _res, next) => {
    req.context = { requestId: 'test', logger: noopLogger }
    next()
  }
  /** A failure, so that the limiters that count failures only (`skipSuccessful`) count it. */
  const failed: RequestHandler = (_req, res) => {
    res.status(401).end()
  }

  /** Name, limiter, the code it answers, and the length of its window in seconds. */
  const LIMITERS: readonly (readonly [string, RequestHandler, string, number])[] = [
    ['joinLimiter', joinLimiter(1), 'rate.limited', 60],
    ['loginLimiter', loginLimiter(1), 'rate.limited', 60],
    ['passwordResetLimiter', passwordResetLimiter(1), 'rate.limited', 60],
    ['invitationLimiter', invitationLimiter(1), 'rate.limited', 60],
    ['uploadLimiter', uploadLimiter(1), 'rate.limited', 60],
    ['reactionLimiter', reactionLimiter(1), 'reaction.rateLimited', 60],
    ['guestWriteLimiter', guestWriteLimiter(1), 'rate.limited', 60],
    ['eventCreationLimiter', eventCreationLimiter(1), 'event.creationRateLimited', 3_600],
    ['invitationIssueLimiter', invitationIssueLimiter(1), 'rate.limited', 3_600],
    ['secondFactorLimiter', secondFactorLimiter(1), 'rate.limited', 60],
    [
      'secondFactorAccountLimiter',
      secondFactorAccountLimiter(),
      'auth.tooManySecondFactorAttempts',
      15 * 60,
    ],
    ['galleryLimiter', galleryLimiter(1), 'rate.limited', 60],
    ['galleryMediaLimiter', galleryMediaLimiter(1), 'rate.limited', 60],
    [
      'galleryUnlockLimiters (per client)',
      galleryUnlockLimiters({ perClient: 1, perLink: 1_000 })[0] as RequestHandler,
      'gallery.tooManyAttempts',
      15 * 60,
    ],
    [
      'galleryUnlockLimiters (per link)',
      galleryUnlockLimiters({ perClient: 1_000, perLink: 1 })[1] as RequestHandler,
      'gallery.tooManyAttempts',
      15 * 60,
    ],
  ]

  it.each(LIMITERS)('%s', async (_name, limiter, code, windowSeconds) => {
    const app = express()
    app.post('/x', withContext, limiter, failed)

    let refused: request.Response | undefined
    for (
      let attempt = 0;
      attempt <= SECOND_FACTOR_FAILURES_PER_ACCOUNT && refused === undefined;
      attempt += 1
    ) {
      const response = await request(app).post('/x')
      if (response.status === 429) refused = response
    }

    expect(refused, 'the limiter never refused').toBeDefined()
    expect(refused?.body.error.code).toBe(code)
    // The wait is the rest of this limiter's own window, which is just begun: pinned from both sides so
    // that an hour shrunk to a minute, or the reverse, is not a limiter that still says "some seconds".
    const wait = Number(refused?.headers['retry-after'])
    expect(wait).toBeLessThanOrEqual(windowSeconds)
    expect(wait).toBeGreaterThanOrEqual(windowSeconds - 10)
    // And the standard `RateLimit` pair (draft 7) that goes with it, which clients that read headers use.
    expect(refused?.headers['ratelimit-policy']).toBeDefined()
    expect(refused?.headers['ratelimit']).toBeDefined()
  })
})

describe('the client key', () => {
  it.each([
    ['uploads', uploadLimiter],
    ['reactions', reactionLimiter],
    ['guest writes', guestWriteLimiter],
  ])(
    'collapses two addresses in one IPv6 subnet into a single %s bucket',
    async (_label, limiter) => {
      const app = behindOneProxy((subject) => {
        subject.post('/events/:eventSlug/photos', limiter(1), noContent)
      })

      await request(app)
        .post('/events/mariage/photos')
        .set('X-Forwarded-For', SAME_SUBNET[0])
        .expect(204)
      const second = await request(app)
        .post('/events/mariage/photos')
        .set('X-Forwarded-For', SAME_SUBNET[1])

      expect(second.status).toBe(429)
    },
  )

  it('keeps a different IPv6 subnet in its own bucket', async () => {
    // The collapse must not go so far that one customer's burst limits another's.
    const app = behindOneProxy((subject) => {
      subject.post('/events/:eventSlug/photos', uploadLimiter(1), noContent)
    })

    await request(app)
      .post('/events/mariage/photos')
      .set('X-Forwarded-For', SAME_SUBNET[0])
      .expect(204)
    const other = await request(app)
      .post('/events/mariage/photos')
      .set('X-Forwarded-For', OTHER_SUBNET)

    expect(other.status).toBe(204)
  })

  it('keeps two IPv4 clients in separate buckets', async () => {
    const app = behindOneProxy((subject) => {
      subject.post('/events/:eventSlug/photos', uploadLimiter(1), noContent)
    })

    await request(app)
      .post('/events/mariage/photos')
      .set('X-Forwarded-For', '203.0.113.7')
      .expect(204)
    const other = await request(app)
      .post('/events/mariage/photos')
      .set('X-Forwarded-For', '203.0.113.8')

    expect(other.status).toBe(204)
  })
})

describe('the upload key', () => {
  it('counts one event separately from another for the same client', async () => {
    // One box can host two weddings on the same evening. A burst on one must not close
    // uploads on the other.
    const app = behindOneProxy((subject) => {
      subject.post('/events/:eventSlug/photos', uploadLimiter(1), noContent)
    })

    await request(app)
      .post('/events/mariage/photos')
      .set('X-Forwarded-For', SAME_SUBNET[0])
      .expect(204)
    const otherEvent = await request(app)
      .post('/events/gala/photos')
      .set('X-Forwarded-For', SAME_SUBNET[0])

    expect(otherEvent.status).toBe(204)
  })

  it('spends the same bucket for repeated uploads to one event', async () => {
    const app = behindOneProxy((subject) => {
      subject.post('/events/:eventSlug/photos', uploadLimiter(1), noContent)
    })

    await request(app)
      .post('/events/mariage/photos')
      .set('X-Forwarded-For', SAME_SUBNET[0])
      .expect(204)
    const again = await request(app)
      .post('/events/mariage/photos')
      .set('X-Forwarded-For', SAME_SUBNET[0])

    expect(again.status).toBe(429)
  })
})

describe('the event segment of an event-keyed limiter', () => {
  /** Neither can be an event: one is not lower-case, the other is past `Slug.maxLength`. */
  const NOT_A_SLUG = 'Mariage'
  const TOO_LONG_TO_BE_A_SLUG = 'z'.repeat(65)

  it.each([
    ['uploads', uploadLimiter],
    ['reactions', reactionLimiter],
    ['guest writes', guestWriteLimiter],
  ])(
    'collapses every unparseable %s slug into one bucket, so invented slugs cannot mint a bucket each',
    async (_label, limiter) => {
      // The limiter runs before `requireGuest`, deliberately, so nothing has validated
      // `:eventSlug` when the key is built. Interpolated raw, every invented segment
      // bought its own entry in the in-memory store, sized by whatever the caller typed
      // — the caller choosing both the number of keys and their length. Parsed with
      // `Slug.create`, they all land in the `none` bucket instead.
      const app = behindOneProxy((subject) => {
        subject.post('/events/:eventSlug/photos', limiter(1), noContent)
      })

      await request(app)
        .post(`/events/${NOT_A_SLUG}/photos`)
        .set('X-Forwarded-For', SAME_SUBNET[0])
        .expect(204)
      const second = await request(app)
        .post(`/events/${TOO_LONG_TO_BE_A_SLUG}/photos`)
        .set('X-Forwarded-For', SAME_SUBNET[0])

      expect(second.status).toBe(429)
    },
  )

  it('keeps a real event out of that bucket, so nonsense cannot close a wedding', async () => {
    // The collapse must not go so far that spending the `none` bucket spends the
    // bucket a guest at an actual event is using.
    const app = behindOneProxy((subject) => {
      subject.post('/events/:eventSlug/photos', uploadLimiter(1), noContent)
    })

    await request(app)
      .post(`/events/${NOT_A_SLUG}/photos`)
      .set('X-Forwarded-For', SAME_SUBNET[0])
      .expect(204)
    const real = await request(app)
      .post('/events/mariage/photos')
      .set('X-Forwarded-For', SAME_SUBNET[0])

    expect(real.status).toBe(204)
  })
})

describe('the account key', () => {
  /** What `requireUser` leaves on the request ahead of this limiter. */
  const signedInAs = (userId: UserId): RequestHandler => {
    const user: UserPrincipal = {
      kind: 'user',
      userId,
      email: 'host@example.test',
    }
    return (req, _res, next) => {
      req.context = { requestId: 'test', logger: noopLogger, user }
      next()
    }
  }

  const HOST_ONE = asUserId('user-host-one')
  const HOST_TWO = asUserId('user-host-two')

  it('spends one account’s allowance regardless of which address it comes from', async () => {
    const limiter = eventCreationLimiter(1)
    const app = behindOneProxy((subject) => {
      subject.post('/events', signedInAs(HOST_ONE), limiter, noContent)
    })

    await request(app).post('/events').set('X-Forwarded-For', SAME_SUBNET[0]).expect(204)
    const fromElsewhere = await request(app).post('/events').set('X-Forwarded-For', OTHER_SUBNET)

    expect(fromElsewhere.status).toBe(429)
    expect(fromElsewhere.body).toMatchObject({ error: { code: 'event.creationRateLimited' } })
  })

  it('keeps two accounts behind the same address in separate buckets', async () => {
    // The ordinary case this key exists for: an office, or a venue's own guest Wi-Fi,
    // is one address shared by several hosts, and one of them spending their allowance
    // must not spend a colleague's.
    const limiter = eventCreationLimiter(1)
    const app = express()
    app.set('trust proxy', 1)
    app.post('/events/as/:who', (req, res, next) => {
      signedInAs(req.params['who'] === 'one' ? HOST_ONE : HOST_TWO)(req, res, next)
    })
    app.post('/events/as/:who', limiter, noContent)

    await request(app).post('/events/as/one').set('X-Forwarded-For', SAME_SUBNET[0]).expect(204)
    const second = await request(app).post('/events/as/one').set('X-Forwarded-For', SAME_SUBNET[0])
    const otherAccount = await request(app)
      .post('/events/as/two')
      .set('X-Forwarded-For', SAME_SUBNET[0])

    expect(second.status).toBe(429)
    expect(otherAccount.status).toBe(204)
  })
})

describe('an event-keyed limiter on a route with no event in its path', () => {
  it.each([
    ['uploads', uploadLimiter],
    ['reactions', reactionLimiter],
    ['guest writes', guestWriteLimiter],
  ])('still limits %s rather than keying on nothing', async (_label, limiter) => {
    // Both of these key on `:eventSlug`. Mounted where there is no such parameter the
    // key must stay stable per client, so the limit still holds — the alternative is a
    // key containing `undefined`, which is one shared bucket for every client at once.
    const app = behindOneProxy((subject) => {
      subject.post('/anywhere', limiter(1), noContent)
    })

    await request(app).post('/anywhere').set('X-Forwarded-For', SAME_SUBNET[0]).expect(204)
    const second = await request(app).post('/anywhere').set('X-Forwarded-For', SAME_SUBNET[1])
    const otherClient = await request(app).post('/anywhere').set('X-Forwarded-For', OTHER_SUBNET)

    expect(second.status).toBe(429)
    expect(otherClient.status).toBe(204)
  })
})

/**
 * Concurrency, which is a different question from rate and needs a different test.
 *
 * A per-minute limiter can be exercised with supertest, because each request finishes.
 * What the stream limiter counts is connections that never finish — so these hold real
 * sockets open against a real listener and ask what the next client is told.
 */
describe('the stream connection limiter', () => {
  const servers: http.Server[] = []
  const open: Connection[] = []

  afterEach(async () => {
    for (const connection of open.splice(0)) connection.close()
    for (const server of servers.splice(0)) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  interface Connection {
    readonly status: number
    readonly headers: http.IncomingHttpHeaders
    readonly body: string
    close(): void
  }

  /** A route that answers and then holds the socket, the way a stream does. */
  const listening = async (limits: { perClient: number; total: number }): Promise<number> => {
    const held: Response[] = []
    const app = express()
    app.set('trust proxy', 1)
    app.get('/events/:eventSlug/stream', streamConnectionLimiter(limits), (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(': connected\n\n')
      held.push(res)
    })

    const server = http.createServer(app)
    server.on('close', () => {
      for (const response of held.splice(0)) response.end()
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return (server.address() as AddressInfo).port
  }

  /** Opens one connection and resolves as soon as the server has answered its headers. */
  const connect = (port: number, address: string): Promise<Connection> =>
    new Promise((resolve, reject) => {
      const outgoing = http.get(
        { port, path: '/events/mariage/stream', headers: { 'X-Forwarded-For': address } },
        (incoming) => {
          incoming.setEncoding('utf8')
          let body = ''
          incoming.on('data', (chunk: string) => {
            body += chunk
          })
          const connection: Connection = {
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            get body() {
              return body
            },
            close: () => {
              outgoing.destroy()
              incoming.destroy()
            },
          }
          open.push(connection)
          resolve(connection)
        },
      )
      outgoing.on('error', reject)
    })

  it('refuses a client already holding its share of open streams', async () => {
    // The route nothing limited, and the only one that ties up a socket, an interval
    // and a subscription for hours. A requests-per-minute limiter would have let one
    // laptop hold two hundred of them as long as it opened them slowly.
    const port = await listening({ perClient: 2, total: 10 })

    const first = await connect(port, SAME_SUBNET[0])
    const second = await connect(port, SAME_SUBNET[0])
    const third = await connect(port, SAME_SUBNET[0])

    expect([first.status, second.status]).toEqual([200, 200])
    expect(third.status).toBe(429)
    expect(third.body).toContain('rate.limited')
  })

  it('counts one IPv6 subnet as one client', async () => {
    // The same collapse every other limiter uses: a residential /64 means a per-address
    // budget is no budget at all, and a second notion of "client" for this one route is
    // how two limits end up disagreeing about who is being limited.
    const port = await listening({ perClient: 1, total: 10 })

    await connect(port, SAME_SUBNET[0])
    const sameHousehold = await connect(port, SAME_SUBNET[1])

    expect(sameHousehold.status).toBe(429)
  })

  it('keeps one client’s budget out of another’s', async () => {
    // A venue and an attacker can share nothing but the process. Filling one bucket
    // must not close the wall for everyone else.
    const port = await listening({ perClient: 1, total: 10 })

    await connect(port, SAME_SUBNET[0])
    const elsewhere = await connect(port, OTHER_SUBNET)

    expect(elsewhere.status).toBe(200)
  })

  it('gives the slot back when a stream closes', async () => {
    // What is counted is what is held, not what has ever connected. A projector that
    // reconnects every few minutes over eight hours must not exhaust its own budget.
    const port = await listening({ perClient: 1, total: 10 })
    const first = await connect(port, SAME_SUBNET[0])
    const refused = await connect(port, SAME_SUBNET[0])
    expect(refused.status).toBe(429)
    // Like the 503 of a full process: a slot frees the moment one of this client's streams closes
    // (HTTP-M-04: this 429 used to bypass `sendError` and carry no header).
    expect(refused.headers['retry-after']).toBe('30')

    first.close()

    await expect
      .poll(async () => (await connect(port, SAME_SUBNET[0])).status, { timeout: 3_000 })
      .toBe(200)
  })

  it('answers 503 rather than 429 once the process itself is full', async () => {
    // Not this client's fault and not something this client can fix by waiting its
    // turn: the same answer `/api/ready` gives about a state that is temporary.
    const port = await listening({ perClient: 5, total: 1 })
    await connect(port, SAME_SUBNET[0])

    const refused = await connect(port, OTHER_SUBNET)

    expect(refused.status).toBe(503)
    expect(refused.body).toContain('service.notReady')
    expect(refused.headers['retry-after']).toBe('30')
  })
})

/**
 * Concurrency, exactly the reason `streamConnectionLimiter` above gets its own real
 * listener rather than supertest: a request held aside while the test polls for
 * something else never actually reaches the server unless something has already called
 * `.end()` on it, which bare `request(app).get(...)` does not do on its own. Real
 * sockets against a real listener sidestep that entirely.
 */
describe('uploadConcurrencyLimiter', () => {
  // One real listener for the whole block, each test mounting its own route at a path
  // nobody else uses — rebinding a fresh ephemeral port per test, on this machine,
  // raced a slow-to-release previous one closing (`EADDRINUSE` on a `connect`, of all
  // things) often enough to make the suite flaky. A single long-lived server sidesteps
  // the rebind entirely; what is under test is the counter in the middleware's own
  // closure, which a fresh `uploadConcurrencyLimiter(max)` per route already isolates
  // per test.
  let server: http.Server
  let app: Express
  let port: number
  let routeCount = 0

  beforeAll(async () => {
    app = express()
    server = http.createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  interface HeldRoute {
    readonly path: string
    pending(): number
    releaseOne(): void
  }

  /**
   * Stands in for `requireGuest`, which is what puts the event on the context in the real
   * routes: the event is named by the `event` query parameter, and a request that names none
   * is one with no valid token, which carries no event at all.
   */
  const asGuestOfEvent: RequestHandler = (req, _res, next) => {
    const event = req.query['event']
    req.context = (typeof event === 'string'
      ? { event: { id: event } }
      : {}) as unknown as typeof req.context
    next()
  }

  /** A route that waits for the test to let it finish, so several requests can be held "buffering" at once. */
  const heldRoute = (max: number, perEvent: number = max): HeldRoute => {
    routeCount += 1
    const path = `/upload-${routeCount}`
    const held: Array<() => void> = []
    app.get(path, asGuestOfEvent, uploadConcurrencyLimiter({ max, perEvent }), (_req, res) => {
      new Promise<void>((resolve) => held.push(resolve)).then(() => res.status(204).end())
    })
    return { path, pending: () => held.length, releaseOne: () => held.shift()?.() }
  }

  /**
   * One request against the shared listener, resolved once the whole response has
   * arrived. `host` is explicit — the default `'localhost'` resolves to both `::1` and
   * `127.0.0.1`, and Node's Happy-Eyeballs race between them produced a spurious
   * `EADDRINUSE` on this machine, which a fixed destination address sidesteps entirely.
   */
  const fetch = (
    path: string,
  ): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> =>
    new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path }, (incoming) => {
          incoming.setEncoding('utf8')
          let body = ''
          incoming.on('data', (chunk: string) => {
            body += chunk
          })
          incoming.on('end', () => {
            resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body })
          })
        })
        .on('error', reject)
    })

  it('admits requests up to the limit and refuses the next with 429 upload.busy', async () => {
    const route = heldRoute(2)

    const first = fetch(`${route.path}?event=a`)
    const second = fetch(`${route.path}?event=a`)
    await expect.poll(() => route.pending()).toBe(2)

    const third = await fetch(`${route.path}?event=a`)
    expect(third.status).toBe(429)
    expect(JSON.parse(third.body).error.code).toBe('upload.busy')
    // Short on purpose: a slot frees as soon as a request already buffering finishes,
    // seconds away, never the clip queue's "about a minute".
    expect(third.headers['retry-after']).toBe('2')

    route.releaseOne()
    route.releaseOne()
    expect((await first).status).toBe(204)
    expect((await second).status).toBe(204)
  })

  it('frees a slot as soon as one held request finishes, admitting the next', async () => {
    // What is counted is what is held, not what has ever arrived — the same property
    // streamConnectionLimiter's own "gives the slot back" test pins.
    const route = heldRoute(1)

    const first = fetch(`${route.path}?event=a`)
    await expect.poll(() => route.pending()).toBe(1)

    const refused = await fetch(`${route.path}?event=a`)
    expect(refused.status).toBe(429)

    route.releaseOne()
    expect((await first).status).toBe(204)

    // Admitted, not refused — proven by reaching the handler and being held there, not
    // by letting it complete; nothing but this test's own `releaseOne` ever finishes it.
    const afterward = fetch(`${route.path}?event=a`)
    await expect.poll(() => route.pending()).toBe(1)

    route.releaseOne()
    expect((await afterward).status).toBe(204)
  })

  /**
   * A fake response good enough to drive `uploadConcurrencyLimiter` directly: it is an
   * `EventEmitter` (so `res.on('close', …)` and a manual `emit('close')` work) and
   * records the status/body a refusal would set, without a real socket.
   *
   * Real HTTP cannot be made to fire `close` twice for one response on demand — in
   * today's Node that event fires exactly once per response — so this is the only way
   * to exercise the hazard the guard names: `close` firing again regardless.
   */
  class FakeUploadResponse extends EventEmitter {
    statusCode = 200
    body: unknown

    setHeader(): this {
      return this
    }

    status(code: number): this {
      this.statusCode = code
      return this
    }

    json(payload: unknown): this {
      this.body = payload
      return this
    }
  }

  const callLimiter = (
    limiter: RequestHandler,
    res: FakeUploadResponse,
    eventId = 'event-1',
  ): { admitted: boolean } => {
    const result = { admitted: false }
    const next: NextFunction = () => {
      result.admitted = true
    }
    limiter(
      { context: { event: { id: eventId } } } as unknown as Request,
      res as unknown as Response,
      next,
    )
    return result
  }

  it('gives a request with no valid guest, hence no event, no slot and a 401', async () => {
    // Behind `requireGuest` nobody reaches this without an event; a route mounted in the
    // wrong order must fail closed instead of letting an anonymous request hold a slot.
    const route = heldRoute(2)

    const refused = await fetch(route.path)

    expect(refused.status).toBe(401)
    expect(route.pending()).toBe(0)
    // And it took nothing: both slots are still there.
    const first = fetch(`${route.path}?event=a`)
    const second = fetch(`${route.path}?event=b`)
    await expect.poll(() => route.pending()).toBe(2)
    route.releaseOne()
    route.releaseOne()
    await first
    await second
  })

  it('does not let one event take every slot while another event is sending', async () => {
    const route = heldRoute(4, 3)

    const held = [1, 2, 3].map(() => fetch(`${route.path}?event=a`))
    await expect.poll(() => route.pending()).toBe(3)

    const fourthOfA = await fetch(`${route.path}?event=a`)
    expect(fourthOfA.status).toBe(429)
    expect(JSON.parse(fourthOfA.body).error.code).toBe('upload.busy')

    // The slot event a could not have is there for event b.
    const forB = fetch(`${route.path}?event=b`)
    await expect.poll(() => route.pending()).toBe(4)

    for (let i = 0; i < 4; i += 1) route.releaseOne()
    await Promise.all([...held, forB])
  })

  it('keeps the box-wide ceiling even when each event is under its own', async () => {
    // Memory is what the global figure bounds: two events at two slots each is still four.
    const route = heldRoute(3, 2)

    const held = [
      fetch(`${route.path}?event=a`),
      fetch(`${route.path}?event=a`),
      fetch(`${route.path}?event=b`),
    ]
    await expect.poll(() => route.pending()).toBe(3)

    const refused = await fetch(`${route.path}?event=c`)
    expect(refused.status).toBe(429)

    for (let i = 0; i < 3; i += 1) route.releaseOne()
    await Promise.all(held)
  })

  it('gives an event its slot back when a request ends, so the cap does not drift', async () => {
    const route = heldRoute(4, 1)

    const first = fetch(`${route.path}?event=a`)
    await expect.poll(() => route.pending()).toBe(1)
    route.releaseOne()
    await first

    const again = fetch(`${route.path}?event=a`)
    await expect.poll(() => route.pending()).toBe(1)
    route.releaseOne()
    expect((await again).status).toBe(204)
  })

  it('gives the slot back whether the request succeeded, was refused downstream or failed', async () => {
    routeCount += 1
    const path = `/upload-outcomes-${routeCount}`
    app.get(
      path,
      asGuestOfEvent,
      uploadConcurrencyLimiter({ max: 1, perEvent: 1 }),
      (req: Request, res: Response, next: NextFunction) => {
        const outcome = req.query['outcome']
        if (outcome === 'refuse') {
          res.status(409).json({ refused: true })
          return
        }
        if (outcome === 'fail') {
          next(new Error('boom'))
          return
        }
        res.status(204).end()
      },
      (_error: unknown, _req: Request, res: Response, _next: NextFunction) => {
        res.status(500).json({ failed: true })
      },
    )

    const statuses: number[] = []
    for (const outcome of ['ok', 'refuse', 'fail', 'ok', 'fail', 'refuse']) {
      statuses.push((await fetch(`${path}?event=a&outcome=${outcome}`)).status)
    }

    // Never a 429: after every kind of ending the single slot was free again.
    expect(statuses).toEqual([204, 409, 500, 204, 500, 409])
  })

  it('never double-releases a slot when the same response fires close twice', () => {
    // One instance, one slot: everything below shares it, the same way one middleware
    // instance is shared by every request to a mounted route.
    const limiter = uploadConcurrencyLimiter({ max: 1, perEvent: 1 })

    const held = new FakeUploadResponse()
    expect(callLimiter(limiter, held).admitted).toBe(true)

    // The hazard itself: the same response's `close` firing a second time. If `release`
    // were not idempotent, this would free the slot twice.
    held.emit('close')
    held.emit('close')

    // One slot was freed, not two: the next request is admitted and takes it...
    const first = new FakeUploadResponse()
    expect(callLimiter(limiter, first).admitted).toBe(true)

    // ...and a second, concurrent one is refused — exactly `max` in flight, not `max`
    // plus whatever the double release handed out for free.
    const second = new FakeUploadResponse()
    expect(callLimiter(limiter, second).admitted).toBe(false)
    expect(second.statusCode).toBe(429)
  })
})

describe('uploadBodyDeadline', () => {
  let server: http.Server
  let app: Express
  let port: number
  let routeCount = 0

  beforeAll(async () => {
    app = express()
    server = http.createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  const withEvent: RequestHandler = (req, _res, next) => {
    req.context = { event: { id: 'a' } } as unknown as typeof req.context
    next()
  }

  /** A route like the real ones: slot, deadline, then something that reads the whole body. */
  const uploadRoute = (timeoutMs: number, afterBodyMs = 0): string => {
    routeCount += 1
    const path = `/deadline-${routeCount}`
    app.post(
      path,
      withEvent,
      uploadConcurrencyLimiter({ max: 1, perEvent: 1 }),
      uploadBodyDeadline(timeoutMs),
      (req, res) => {
        req.on('data', () => undefined)
        req.on('end', () => {
          setTimeout(() => res.status(201).json({ ok: true }), afterBodyMs)
        })
      },
    )
    return path
  }

  interface Answer {
    readonly status: number
    readonly body: string
    readonly connection: string | undefined
  }

  /** Sends `first`, then `rest` after `pauseMs` (never, when `rest` is undefined: the body just hangs). */
  const post = (path: string, first: string, pauseMs: number, rest?: string): Promise<Answer> =>
    new Promise((resolve, reject) => {
      const outgoing = http.request(
        {
          host: '127.0.0.1',
          port,
          path,
          method: 'POST',
          agent: false,
          headers: { 'content-length': '100' },
        },
        (incoming) => {
          let body = ''
          incoming.setEncoding('utf8')
          incoming.on('data', (chunk: string) => {
            body += chunk
          })
          incoming.on('end', () =>
            resolve({
              status: incoming.statusCode ?? 0,
              body,
              connection: incoming.headers.connection,
            }),
          )
        },
      )
      outgoing.on('error', reject)
      outgoing.write(first)
      if (rest === undefined) return
      setTimeout(() => outgoing.end(rest), pauseMs)
    })

  it('ends a body that is still arriving past the deadline with 408 upload.timedOut and frees the slot', async () => {
    const path = uploadRoute(100)

    const slow = await post(path, 'x'.repeat(10), 0)

    expect(slow.status).toBe(408)
    expect(JSON.parse(slow.body).error.code).toBe('upload.timedOut')
    // Told to the client, so a proxy or phone does not try to reuse a connection mid-body.
    expect(slow.connection).toBe('close')

    // The single slot is free again: a complete upload is admitted, not refused 429.
    const next = await post(path, 'y'.repeat(10), 0, 'z'.repeat(90))
    expect(next.status).toBe(201)
  })

  it('lets a slow body that arrives inside the deadline through', async () => {
    const path = uploadRoute(2_000)

    const answer = await post(path, 'x'.repeat(10), 150, 'y'.repeat(90))

    expect(answer.status).toBe(201)
  })

  it('does not cut off the work done after the body has fully arrived', async () => {
    // The deadline is for reception. A decode that outlasts it must still answer.
    const path = uploadRoute(100, 300)

    const answer = await post(path, 'x'.repeat(10), 0, 'y'.repeat(90))

    expect(answer.status).toBe(201)
  })
})
