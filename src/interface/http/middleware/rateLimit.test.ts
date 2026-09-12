import http from 'node:http'
import type { AddressInfo } from 'node:net'
import express, { type Express, type RequestHandler, type Response } from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { reactionLimiter, streamConnectionLimiter, uploadLimiter } from './rateLimit'

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
