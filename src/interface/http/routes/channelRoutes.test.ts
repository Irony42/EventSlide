import type { Express } from 'express'
import request from '../testing/request'
import type { Agent } from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeListBindings } from '../../../application/usecases/channels/listBindings'
import { makeUnbindConversation } from '../../../application/usecases/channels/unbindConversation'
import { AT, anEvent, aUser } from '../../../application/testing/builders'
import { aBinding } from '../../../application/testing/contracts/channelBindingRepositoryContract'
import { FakeChannelBindingRepository } from '../../../application/testing/fakeChannelBindingRepository'
import { FakeClientRepository } from '../../../application/testing/fakeClientRepository'
import { FakeEventRepository } from '../../../application/testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../../application/testing/fakeMembershipRepository'
import { FakeMessagingChannel } from '../../../application/testing/fakeMessagingChannel'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { FakeUserRepository } from '../../../application/testing/fakeUserRepository'
import type { ChannelKind } from '../../../domain/channels/channelKind'
import { asChannelBindingId, asEventId, asUserId } from '../../../domain/shared/ids'
import type { MessagingChannel } from '../../../application/ports/messagingChannel'
import { buildHarness, signInAs } from '../testing/middlewareHarness'
import type { HttpDeps } from '../types'
import { channelRoutes } from './channelRoutes'

/**
 * The host's channel routes (spec 27), driven through a real Express app. Two events with different owners: the case
 * that catches real incidents is the other event's owner reaching for this one, which answers 404, not 403.
 */

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

const OWNER = '11111111-1111-4111-8111-111111111111'
const MODERATOR = '22222222-2222-4222-8222-222222222222'
const GALA_OWNER = '33333333-3333-4333-8333-333333333333'

const SLUG = 'camille-et-sacha'
const GALA_SLUG = 'gala-annuel'

const BINDING = '00000000-0000-4000-8000-000000000001'
const GALA_BINDING = '00000000-0000-4000-8000-000000000002'

interface World {
  readonly app: Express
  readonly bindings: FakeChannelBindingRepository
}

const buildWorld = (withBot: boolean): World => {
  const users = new FakeUserRepository()
  const photos = new FakePhotoRepository()
  const memberships = new FakeMembershipRepository({ users })
  const clients = new FakeClientRepository()
  const events = new FakeEventRepository({ memberships, photos, clients })
  const bindings = new FakeChannelBindingRepository()
  const channels: ReadonlyMap<ChannelKind, MessagingChannel> = withBot
    ? new Map([['telegram', new FakeMessagingChannel('telegram', 'EventSlideBot')]])
    : new Map()

  const harness = buildHarness({
    routes: (app, harnessDeps) => {
      const deps: HttpDeps = { ...harnessDeps, events, memberships, users }
      app.post('/sign-in/owner', signInAs({ userId: OWNER, email: 'hote@example.test' }))
      app.post(
        '/sign-in/moderator',
        signInAs({ userId: MODERATOR, email: 'moderateur@example.test' }),
      )
      app.post('/sign-in/gala-owner', signInAs({ userId: GALA_OWNER, email: 'gala@example.test' }))

      app.use(
        '/api',
        channelRoutes({
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
            listChannelBindings: makeListBindings({
              events,
              clients,
              memberships,
              bindings,
              channels,
            }),
            unbindConversation: makeUnbindConversation({
              events,
              memberships,
              bindings,
              channels,
              clock: deps.clock,
              bus: deps.bus,
            }),
          },
        }),
      )
    },
  })

  users.seed(
    aUser({ id: OWNER, email: 'hote@example.test' }),
    aUser({ id: MODERATOR, email: 'moderateur@example.test' }),
    aUser({ id: GALA_OWNER, email: 'gala@example.test' }),
  )
  events.seed(
    anEvent({ id: WEDDING, ownerId: OWNER, slug: SLUG, joinCode: 'H7K2QM' }),
    anEvent({ id: GALA, ownerId: GALA_OWNER, slug: GALA_SLUG, joinCode: 'Z3N9PT' }),
  )
  memberships.seed(
    { eventId: WEDDING, userId: asUserId(OWNER), role: 'owner', grantedAt: AT },
    { eventId: WEDDING, userId: asUserId(MODERATOR), role: 'moderator', grantedAt: AT },
    { eventId: GALA, userId: asUserId(GALA_OWNER), role: 'owner', grantedAt: AT },
  )
  return { app: harness.app, bindings }
}

type Who = 'owner' | 'moderator' | 'gala-owner'

const signedIn = async (world: World, who: Who): Promise<Agent> => {
  const agent = request.agent(world.app)
  await agent.post(`/sign-in/${who}`).expect(204)
  return agent
}

const seedBindings = async (world: World): Promise<void> => {
  await world.bindings.save(aBinding({ id: BINDING, eventId: WEDDING, conversationRef: '-1001' }))
  await world.bindings.save(aBinding({ id: GALA_BINDING, eventId: GALA, conversationRef: '-2002' }))
}

describe('GET /api/events/:eventSlug/channels', () => {
  let world: World
  beforeEach(async () => {
    world = buildWorld(true)
    await seedBindings(world)
  })

  it('lets a moderator read the bot and the groups, with no reference and no key', async () => {
    const agent = await signedIn(world, 'moderator')

    const response = await agent.get(`/api/events/${SLUG}/channels`)

    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.body).toEqual({
      available: true,
      botUsername: 'EventSlideBot',
      allowed: true,
      readsAllMessages: true,
      bindings: [
        {
          id: BINDING,
          channel: 'telegram',
          title: expect.any(String),
          boundAt: expect.any(String),
          photoCount: 0,
        },
      ],
    })
    expect(JSON.stringify(response.body)).not.toContain('-1001')
  })

  it('says the box has no bot when none is configured', async () => {
    const bare = buildWorld(false)
    const agent = await signedIn(bare, 'owner')

    const response = await agent.get(`/api/events/${SLUG}/channels`)

    expect(response.body).toMatchObject({
      available: false,
      botUsername: null,
      readsAllMessages: null,
      bindings: [],
    })
  })

  it('answers 404 to the owner of another event, and 401 to nobody', async () => {
    const other = await signedIn(world, 'gala-owner')
    expect((await other.get(`/api/events/${SLUG}/channels`)).status).toBe(404)

    expect((await request(world.app).get(`/api/events/${SLUG}/channels`)).status).toBe(401)
  })
})

describe('DELETE /api/events/:eventSlug/channels/:bindingId', () => {
  let world: World
  beforeEach(async () => {
    world = buildWorld(true)
    await seedBindings(world)
  })

  it('lets the owner unlink a group', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent.delete(`/api/events/${SLUG}/channels/${BINDING}`)

    expect(response.status).toBe(204)
    expect(await world.bindings.listActiveForEvent(WEDDING)).toEqual([])
  })

  it('refuses a moderator: only the owner unlinks', async () => {
    const agent = await signedIn(world, 'moderator')

    const response = await agent.delete(`/api/events/${SLUG}/channels/${BINDING}`)

    expect(response.status).toBe(403)
    expect(await world.bindings.listActiveForEvent(WEDDING)).toHaveLength(1)
  })

  it('never unlinks another event binding through this event path', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent.delete(`/api/events/${SLUG}/channels/${GALA_BINDING}`)

    expect(response.status).toBe(404)
    expect(response.body).toMatchObject({ error: { code: 'channel.bindingNotFound' } })
    expect(await world.bindings.listActiveForEvent(GALA)).toHaveLength(1)
  })

  it('rejects an id that is not an id', async () => {
    const agent = await signedIn(world, 'owner')

    expect((await agent.delete(`/api/events/${SLUG}/channels/not-an-id`)).status).toBe(400)
  })

  it('answers 404 to the owner of another event', async () => {
    const agent = await signedIn(world, 'gala-owner')

    expect((await agent.delete(`/api/events/${SLUG}/channels/${BINDING}`)).status).toBe(404)
    expect(asChannelBindingId(BINDING)).toBe(BINDING)
  })
})
