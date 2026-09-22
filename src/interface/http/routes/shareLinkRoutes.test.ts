import type { Express } from 'express'
import request, { type Agent } from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeCreateShareLink } from '../../../application/usecases/gallery/createShareLink'
import { makeGetShareLink } from '../../../application/usecases/gallery/getShareLink'
import { makeRevokeShareLink } from '../../../application/usecases/gallery/revokeShareLink'
import { AT, anEvent, aShareLink, aUser } from '../../../application/testing/builders'
import { FakeEventRepository } from '../../../application/testing/fakeEventRepository'
import { FakeGallerySigner } from '../../../application/testing/fakeGallerySigner'
import { FakeMembershipRepository } from '../../../application/testing/fakeMembershipRepository'
import { FakePasswordHasher } from '../../../application/testing/fakePasswordHasher'
import { FakeShareLinkRepository } from '../../../application/testing/fakeShareLinkRepository'
import { FakeUserRepository } from '../../../application/testing/fakeUserRepository'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { buildHarness, signInAs } from '../testing/middlewareHarness'
import type { HttpDeps } from '../types'
import { shareLinkRoutes } from './shareLinkRoutes'

/**
 * The host's side of the shared gallery, through a real Express app.
 *
 * Every write here ships with the five cases the HTTP recipe asks of a mutating route —
 * happy, unauthenticated, wrong tenant, wrong role, malformed — and the wrong-tenant one
 * answers **404**, because a 403 would confirm somebody else's wedding exists.
 */

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const OWNER = '11111111-1111-4111-8111-111111111111'
const MODERATOR = '22222222-2222-4222-8222-222222222222'
const GALA_OWNER = '33333333-3333-4333-8333-333333333333'
const SLUG = 'camille-et-sacha'
const DAY = 24 * 60 * 60 * 1000

interface World {
  readonly app: Express
  readonly shareLinks: FakeShareLinkRepository
}

const buildWorld = (): World => {
  const users = new FakeUserRepository()
  const memberships = new FakeMembershipRepository({ users })
  const events = new FakeEventRepository({ memberships })
  const shareLinks = new FakeShareLinkRepository()

  const harness = buildHarness({
    config: { publicUrl: 'https://photos.example.test' },
    routes: (app, harnessDeps) => {
      const deps: HttpDeps = { ...harnessDeps, events, memberships, users }
      app.post('/sign-in/owner', signInAs({ userId: OWNER, email: 'hote@example.test' }))
      app.post('/sign-in/moderator', signInAs({ userId: MODERATOR, email: 'mod@example.test' }))
      app.post('/sign-in/gala-owner', signInAs({ userId: GALA_OWNER, email: 'gala@example.test' }))
      app.use(
        '/api',
        shareLinkRoutes({
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
            getShareLink: makeGetShareLink({ events, shareLinks, memberships, clock: deps.clock }),
            createShareLink: makeCreateShareLink({
              events,
              shareLinks,
              memberships,
              hasher: new FakePasswordHasher(),
              signer: new FakeGallerySigner(),
              ids: new SequentialIdGenerator(),
              clock: deps.clock,
            }),
            revokeShareLink: makeRevokeShareLink({
              events,
              shareLinks,
              memberships,
              clock: deps.clock,
            }),
          },
        }),
      )
    },
  })

  users.seed(
    aUser({ id: OWNER, email: 'hote@example.test' }),
    aUser({ id: MODERATOR, email: 'mod@example.test' }),
    aUser({ id: GALA_OWNER, email: 'gala@example.test' }),
  )
  memberships.seed(
    { eventId: WEDDING, userId: asUserId(OWNER), role: 'owner', grantedAt: AT },
    { eventId: WEDDING, userId: asUserId(MODERATOR), role: 'moderator', grantedAt: AT },
    { eventId: GALA, userId: asUserId(GALA_OWNER), role: 'owner', grantedAt: AT },
  )
  events.seed(
    anEvent({ id: WEDDING, ownerId: OWNER, slug: SLUG, status: 'closed' }),
    anEvent({ id: GALA, ownerId: GALA_OWNER, slug: 'gala-annuel', joinCode: 'Z3N9PT' }),
  )

  return { app: harness.app, shareLinks }
}

describe('the host’s share link over HTTP', () => {
  let world: World

  const as = async (who: 'owner' | 'moderator' | 'gala-owner'): Promise<Agent> => {
    const agent = request.agent(world.app)
    await agent.post(`/sign-in/${who}`).expect(204)
    return agent
  }

  beforeEach(() => {
    world = buildWorld()
  })

  describe('POST /api/events/:slug/share-link', () => {
    it('makes a link and answers its address once, from PUBLIC_URL, uncached', async () => {
      const owner = await as('owner')

      const response = await owner
        .post(`/api/events/${SLUG}/share-link`)
        .send({ expiresInDays: 7, password: 'les mariés de juin' })

      expect(response.status).toBe(201)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.body).toEqual({
        link: {
          id: 'share-link-1',
          createdAt: AT.toISOString(),
          expiresAt: new Date(AT.getTime() + 7 * DAY).toISOString(),
          hasPassword: true,
          available: true,
        },
        url: 'https://photos.example.test/g/token-1',
      })
    })

    it('never echoes the password it was given', async () => {
      const owner = await as('owner')

      const response = await owner
        .post(`/api/events/${SLUG}/share-link`)
        .send({ password: 'les mariés de juin' })

      expect(response.text).not.toContain('mariés')
    })

    it('answers 401 without a session', async () => {
      const response = await request(world.app).post(`/api/events/${SLUG}/share-link`).send({})

      expect(response.status).toBe(401)
    })

    it('answers the owner of another event with 404, never 403', async () => {
      const galaOwner = await as('gala-owner')

      const response = await galaOwner.post(`/api/events/${SLUG}/share-link`).send({})

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('event.notFound')
      expect(world.shareLinks.all()).toEqual([])
    })

    it('answers a moderator of the event with 403', async () => {
      const moderator = await as('moderator')

      const response = await moderator.post(`/api/events/${SLUG}/share-link`).send({})

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('auth.forbidden')
    })

    it.each([
      ['a lifetime that is not a whole number', { expiresInDays: 1.5 }],
      ['a lifetime sent as text', { expiresInDays: '30' }],
      ['a field the contract does not have', { expiresInDays: 30, public: true }],
    ])('answers 400 for %s', async (_label, body) => {
      const owner = await as('owner')

      const response = await owner.post(`/api/events/${SLUG}/share-link`).send(body)

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('request.invalid')
    })

    it('answers the domain’s refusal for a lifetime past the ceiling', async () => {
      const owner = await as('owner')

      const response = await owner
        .post(`/api/events/${SLUG}/share-link`)
        .send({ expiresInDays: 91 })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('shareLink.lifetimeInvalid')
    })
  })

  describe('GET /api/events/:slug/share-link', () => {
    it('answers null when the event has no link', async () => {
      const owner = await as('owner')

      const response = await owner.get(`/api/events/${SLUG}/share-link`)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ link: null })
      expect(response.headers['cache-control']).toBe('no-store')
    })

    it('answers the current link without its address, which is not stored', async () => {
      world.shareLinks.seed(aShareLink({ id: 'link-1', eventId: WEDDING, createdBy: OWNER }))
      const owner = await as('owner')

      const response = await owner.get(`/api/events/${SLUG}/share-link`)

      expect(response.body.link).toMatchObject({
        id: 'link-1',
        hasPassword: false,
        available: true,
      })
      expect(response.body.link).not.toHaveProperty('url')
    })

    it('answers the owner of another event with 404', async () => {
      const galaOwner = await as('gala-owner')

      expect((await galaOwner.get(`/api/events/${SLUG}/share-link`)).status).toBe(404)
    })

    it('answers a moderator with 403', async () => {
      const moderator = await as('moderator')

      expect((await moderator.get(`/api/events/${SLUG}/share-link`)).status).toBe(403)
    })
  })

  describe('DELETE /api/events/:slug/share-link', () => {
    it('revokes the current link', async () => {
      world.shareLinks.seed(aShareLink({ id: 'link-1', eventId: WEDDING, createdBy: OWNER }))
      const owner = await as('owner')

      const response = await owner.delete(`/api/events/${SLUG}/share-link`)

      expect(response.status).toBe(204)
      expect(world.shareLinks.all()[0]?.revokedAt).toEqual(AT)
    })

    it('answers the owner of another event with 404, and revokes nothing', async () => {
      world.shareLinks.seed(aShareLink({ id: 'link-1', eventId: WEDDING, createdBy: OWNER }))
      const galaOwner = await as('gala-owner')

      const response = await galaOwner.delete(`/api/events/${SLUG}/share-link`)

      expect(response.status).toBe(404)
      expect(world.shareLinks.all()[0]?.revokedAt).toBeNull()
    })

    it('answers a moderator with 403, and revokes nothing', async () => {
      world.shareLinks.seed(aShareLink({ id: 'link-1', eventId: WEDDING, createdBy: OWNER }))
      const moderator = await as('moderator')

      expect((await moderator.delete(`/api/events/${SLUG}/share-link`)).status).toBe(403)
      expect(world.shareLinks.all()[0]?.revokedAt).toBeNull()
    })

    it('answers 401 without a session', async () => {
      expect((await request(world.app).delete(`/api/events/${SLUG}/share-link`)).status).toBe(401)
    })
  })
})
