import express, { type Express, type RequestHandler } from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { reactionLimiter, uploadLimiter } from './rateLimit'

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
