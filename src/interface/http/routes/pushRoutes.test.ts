import type { Express } from 'express'
import { PushSubscription } from '../../../domain/push/pushSubscription'
import type { Agent } from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { AT, anEvent, aUser } from '../../../application/testing/builders'
import { FakeEventRepository } from '../../../application/testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../../application/testing/fakeMembershipRepository'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { FakePushSubscriptionRepository } from '../../../application/testing/fakePushSubscriptionRepository'
import { FakeUserRepository } from '../../../application/testing/fakeUserRepository'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import {
  makeGetPushKey,
  makeSubscribePush,
  makeUnsubscribePush,
  makeUnsubscribePushEverywhere,
  type PushConfig,
} from '../../../application/usecases/push/pushSubscriptions'
import { DEFAULT_PUSH_HOSTS } from '../../../domain/push/pushEndpoint'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { buildHarness, signInAs } from '../testing/middlewareHarness'
import request from '../testing/request'
import type { HttpDeps } from '../types'
import { pushRoutes } from './pushRoutes'

/**
 * The host's browser notifications (spec 30, lot 4), through a real Express app: the key for a
 * signed-in account, a subscription that is the owner's, an unsubscription any member may make, a
 * `204` that never says a word of the subscription, and the domain's codes on the wire.
 */

const WEDDING = asEventId('evt-wedding')
const OWNER = '11111111-1111-4111-8111-111111111111'
const MODERATOR = '22222222-2222-4222-8222-222222222222'
const STRANGER = '33333333-3333-4333-8333-333333333333'
const SLUG = 'camille-et-sacha'
const URL = `/api/events/${SLUG}/push-subscription`
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'
const KEYS = { p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) }
const SUBSCRIPTION = { endpoint: ENDPOINT, keys: KEYS }

interface World {
  readonly app: Express
  readonly subscriptions: FakePushSubscriptionRepository
}

const buildWorld = (
  push: PushConfig | null = { publicKey: 'PUBKEY', allowedHosts: DEFAULT_PUSH_HOSTS },
): World => {
  const users = new FakeUserRepository()
  const photos = new FakePhotoRepository()
  const memberships = new FakeMembershipRepository({ users })
  const events = new FakeEventRepository({ memberships, photos })
  const subscriptions = new FakePushSubscriptionRepository()
  const ids = new SequentialIdGenerator()
  const harness = buildHarness({
    users,
    routes: (app, harnessDeps) => {
      const deps: HttpDeps = { ...harnessDeps, events, memberships, users }
      app.post('/sign-in/owner', signInAs({ userId: OWNER, email: 'hote@example.test' }))
      app.post('/sign-in/moderator', signInAs({ userId: MODERATOR, email: 'mod@example.test' }))
      app.post('/sign-in/stranger', signInAs({ userId: STRANGER, email: 'autre@example.test' }))
      app.use(
        '/api',
        pushRoutes({
          deps,
          presenter: {
            publicUrl: deps.config.publicUrl,
            uploadLimits: deps.config.uploads,
            clipLimits: {
              maxBytes: deps.config.clips.maxBytes,
              maxSeconds: deps.config.clips.maxSeconds,
              supported: deps.config.clips.supported,
            },
          },
          usecases: {
            getPushKey: makeGetPushKey(push),
            subscribePush: makeSubscribePush({
              events,
              memberships,
              subscriptions,
              ids,
              clock: deps.clock,
              push,
            }),
            unsubscribePush: makeUnsubscribePush({ subscriptions, push }),
            unsubscribePushEverywhere: makeUnsubscribePushEverywhere({ subscriptions, push }),
          },
        }),
      )
    },
  })
  users.seed(
    aUser({ id: OWNER, email: 'hote@example.test' }),
    aUser({ id: MODERATOR, email: 'mod@example.test' }),
    aUser({ id: STRANGER, email: 'autre@example.test' }),
  )
  events.seed(anEvent({ id: WEDDING, ownerId: OWNER, slug: SLUG, joinCode: 'H7K2QM' }))
  memberships.seed(
    { eventId: WEDDING, userId: asUserId(OWNER), role: 'owner', grantedAt: AT },
    { eventId: WEDDING, userId: asUserId(MODERATOR), role: 'moderator', grantedAt: AT },
  )
  return { app: harness.app, subscriptions }
}

const signedIn = async (world: World, who: 'owner' | 'moderator' | 'stranger'): Promise<Agent> => {
  const agent = request.agent(world.app)
  await agent.post(`/sign-in/${who}`).expect(204)
  return agent
}

describe('GET /api/push/key', () => {
  it('gives a signed-in account the public key, no-store', async () => {
    const response = await (await signedIn(buildWorld(), 'owner')).get('/api/push/key')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ publicKey: 'PUBKEY' })
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('is 401 without a session, and 404 push.disabled while the box has no keys', async () => {
    const world = buildWorld()
    const off = buildWorld(null)

    expect((await request(world.app).get('/api/push/key')).status).toBe(401)
    const disabled = await (await signedIn(off, 'owner')).get('/api/push/key')
    expect([disabled.status, disabled.body.error.code]).toEqual([404, 'push.disabled'])
  })
})

describe('POST /api/events/:eventSlug/push-subscription', () => {
  let world: World

  beforeEach(() => {
    world = buildWorld()
  })

  it('stores the owner’s browser and answers 204, no-store, with nothing of it in the answer', async () => {
    const response = await (await signedIn(world, 'owner')).post(URL).send(SUBSCRIPTION)

    expect(response.status).toBe(204)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.text).toBe('')
    const [stored] = await world.subscriptions.listByEvent(WEDDING)
    expect([stored?.endpoint, stored?.userId]).toEqual([ENDPOINT, OWNER])
  })

  it('accepts what a browser’s toJSON() holds, its expirationTime included, and never stores that', async () => {
    const response = await (
      await signedIn(world, 'owner')
    )
      .post(URL)
      .send({ ...SUBSCRIPTION, expirationTime: null })

    expect(response.status).toBe(204)
  })

  it('is the owner’s: a moderator is 403, a stranger 404, no session 401', async () => {
    expect((await (await signedIn(world, 'moderator')).post(URL).send(SUBSCRIPTION)).status).toBe(
      403,
    )
    expect((await (await signedIn(world, 'stranger')).post(URL).send(SUBSCRIPTION)).status).toBe(
      404,
    )
    expect((await request(world.app).post(URL).send(SUBSCRIPTION)).status).toBe(401)
    expect(await world.subscriptions.listByEvent(WEDDING)).toHaveLength(0)
  })

  it('answers the domain’s codes: an endpoint that is no push service, keys of the wrong shape', async () => {
    const agent = await signedIn(world, 'owner')

    const internal = await agent
      .post(URL)
      .send({ ...SUBSCRIPTION, endpoint: 'https://127.0.0.1/x' })
    const evil = await agent.post(URL).send({ ...SUBSCRIPTION, endpoint: 'https://evil.test/x' })
    const http = await agent
      .post(URL)
      .send({ ...SUBSCRIPTION, endpoint: 'http://fcm.googleapis.com/x' })
    const keys = await agent.post(URL).send({ ...SUBSCRIPTION, keys: { p256dh: 'x', auth: 'y' } })

    expect([internal, evil, http, keys].map((r) => r.status)).toEqual([400, 400, 400, 400])
    expect([internal, evil, http, keys].map((r) => r.body.error.code)).toEqual([
      'push.endpointNotAllowed',
      'push.endpointNotAllowed',
      'push.endpointInvalid',
      'push.keysInvalid',
    ])
    expect(JSON.stringify([internal.body, evil.body])).not.toMatch(/127|evil/u)
  })

  it('refuses a stray key as a malformed request, and the 11th browser as push.tooMany', async () => {
    const agent = await signedIn(world, 'owner')
    expect((await agent.post(URL).send({ ...SUBSCRIPTION, userId: 'x' })).body.error.code).toBe(
      'request.invalid',
    )

    for (let i = 0; i < 10; i += 1) {
      await agent
        .post(URL)
        .send({ ...SUBSCRIPTION, endpoint: `${ENDPOINT}${i}` })
        .expect(204)
    }
    const eleventh = await agent.post(URL).send({ ...SUBSCRIPTION, endpoint: `${ENDPOINT}x` })

    expect([eleventh.status, eleventh.body.error.code]).toEqual([409, 'push.tooMany'])
  })

  it('is 404 push.disabled while the box has no keys', async () => {
    const off = buildWorld(null)

    const response = await (await signedIn(off, 'owner')).post(URL).send(SUBSCRIPTION)

    expect([response.status, response.body.error.code]).toEqual([404, 'push.disabled'])
  })
})

describe('DELETE /api/events/:eventSlug/push-subscription', () => {
  it('forgets this browser for any member, 204 whether there was one or not', async () => {
    const world = buildWorld()
    const owner = await signedIn(world, 'owner')
    await owner.post(URL).send(SUBSCRIPTION).expect(204)

    const moderator = await (
      await signedIn(world, 'moderator')
    )
      .delete(URL)
      .send({ endpoint: ENDPOINT })
    expect(moderator.status).toBe(204)
    expect(await world.subscriptions.listByEvent(WEDDING)).toHaveLength(1)
    const mine = await owner.delete(URL).send({ endpoint: ENDPOINT })
    const again = await owner.delete(URL).send({ endpoint: ENDPOINT })

    expect([mine.status, again.status]).toEqual([204, 204])
    expect(await world.subscriptions.listByEvent(WEDDING)).toHaveLength(0)
  })

  it('is 404 to a stranger, 401 without a session, and refuses a stray key', async () => {
    const world = buildWorld()

    expect(
      (await (await signedIn(world, 'stranger')).delete(URL).send({ endpoint: ENDPOINT })).status,
    ).toBe(404)
    expect((await request(world.app).delete(URL).send({ endpoint: ENDPOINT })).status).toBe(401)
    const stray = await (
      await signedIn(world, 'owner')
    )
      .delete(URL)
      .send({ endpoint: ENDPOINT, keys: {} })
    expect(stray.body.error.code).toBe('request.invalid')
  })
})

describe('DELETE /api/push-subscriptions', () => {
  const ALL = '/api/push-subscriptions'

  it('forgets this browser for every event of the account at once, 204, and nobody else’s', async () => {
    const world = buildWorld()
    const owner = await signedIn(world, 'owner')
    await owner.post(URL).send(SUBSCRIPTION).expect(204)
    const stranger = await signedIn(world, 'stranger')
    await world.subscriptions.upsert(
      PushSubscription.create({
        id: 'theirs',
        userId: asUserId(STRANGER),
        eventId: WEDDING,
        endpoint: ENDPOINT,
        p256dh: SUBSCRIPTION.keys.p256dh,
        auth: SUBSCRIPTION.keys.auth,
        createdAt: new Date(),
      }),
      10,
    )

    const response = await owner.delete(ALL).send({ endpoint: ENDPOINT })

    expect(response.status).toBe(204)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(await world.subscriptions.listByEvent(WEDDING)).toHaveLength(1)
    expect((await stranger.delete(ALL).send({ endpoint: ENDPOINT })).status).toBe(204)
    expect(await world.subscriptions.listByEvent(WEDDING)).toHaveLength(0)
  })

  it('is 204 when nothing is held, 401 without a session, and refuses a stray key', async () => {
    const world = buildWorld()

    expect(
      (await (await signedIn(world, 'owner')).delete(ALL).send({ endpoint: ENDPOINT })).status,
    ).toBe(204)
    expect((await request(world.app).delete(ALL).send({ endpoint: ENDPOINT })).status).toBe(401)
    const stray = await (
      await signedIn(world, 'owner')
    )
      .delete(ALL)
      .send({ endpoint: ENDPOINT, keys: {} })
    expect(stray.body.error.code).toBe('request.invalid')
  })
})
