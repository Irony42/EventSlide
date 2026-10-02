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
import {
  eventCreationLimiter,
  reactionLimiter,
  streamConnectionLimiter,
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

describe('the client key', () => {
  it('collapses two addresses in one IPv6 subnet into a single bucket', async () => {
    const app = behindOneProxy((subject) => {
      subject.post('/events/:eventSlug/photos', uploadLimiter(1), noContent)
    })

    await request(app)
      .post('/events/mariage/photos')
      .set('X-Forwarded-For', SAME_SUBNET[0])
      .expect(204)
    const second = await request(app)
      .post('/events/mariage/photos')
      .set('X-Forwarded-For', SAME_SUBNET[1])

    expect(second.status).toBe(429)
  })

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
    expect((await connect(port, SAME_SUBNET[0])).status).toBe(429)

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

  /** A route that waits for the test to let it finish, so several requests can be held "buffering" at once. */
  const heldRoute = (max: number): HeldRoute => {
    routeCount += 1
    const path = `/upload-${routeCount}`
    const held: Array<() => void> = []
    app.get(path, uploadConcurrencyLimiter(max), (_req, res) => {
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

    const first = fetch(route.path)
    const second = fetch(route.path)
    await expect.poll(() => route.pending()).toBe(2)

    const third = await fetch(route.path)
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

    const first = fetch(route.path)
    await expect.poll(() => route.pending()).toBe(1)

    const refused = await fetch(route.path)
    expect(refused.status).toBe(429)

    route.releaseOne()
    expect((await first).status).toBe(204)

    // Admitted, not refused — proven by reaching the handler and being held there, not
    // by letting it complete; nothing but this test's own `releaseOne` ever finishes it.
    const afterward = fetch(route.path)
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

  const callLimiter = (limiter: RequestHandler, res: FakeUploadResponse): { admitted: boolean } => {
    const result = { admitted: false }
    const next: NextFunction = () => {
      result.admitted = true
    }
    limiter({} as unknown as Request, res as unknown as Response, next)
    return result
  }

  it('never double-releases a slot when the same response fires close twice', () => {
    // One instance, one slot: everything below shares it, the same way one middleware
    // instance is shared by every request to a mounted route.
    const limiter = uploadConcurrencyLimiter(1)

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
