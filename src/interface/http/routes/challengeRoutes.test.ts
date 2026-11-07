import type { Express } from 'express'
import request from '../testing/request'
import type { Agent } from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeGetChallenge } from '../../../application/usecases/challenges/getChallenge'
import { makeStartChallenge } from '../../../application/usecases/challenges/startChallenge'
import { makeStopChallenge } from '../../../application/usecases/challenges/stopChallenge'
import { AT, aMission, anEvent, aUser } from '../../../application/testing/builders'
import { FakeChallengeRepository } from '../../../application/testing/fakeChallengeRepository'
import { FakeEventRepository } from '../../../application/testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../../application/testing/fakeMembershipRepository'
import { FakeMissionRepository } from '../../../application/testing/fakeMissionRepository'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { FakeUserRepository } from '../../../application/testing/fakeUserRepository'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { buildHarness, signInAs } from '../testing/middlewareHarness'
import type { HttpDeps } from '../types'
import { challengeRoutes } from './challengeRoutes'

/**
 * The timed photo challenge routes (spec 10), driven through a real Express app.
 *
 * Two events with different owners, because the case that catches real incidents is the other
 * event's owner reaching for this one: it answers **404**, not 403.
 */

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

const OWNER = '11111111-1111-4111-8111-111111111111'
const MODERATOR = '22222222-2222-4222-8222-222222222222'
const GALA_OWNER = '33333333-3333-4333-8333-333333333333'

const SELFIE = '55555555-5555-4555-8555-555555555555'
const GALA_MISSION = '77777777-7777-4777-8777-777777777777'

const SLUG = 'camille-et-sacha'
const GALA_SLUG = 'gala-annuel'

interface World {
  readonly app: Express
  readonly challenges: FakeChallengeRepository
}

const buildWorld = (): World => {
  const users = new FakeUserRepository()
  const photos = new FakePhotoRepository()
  const memberships = new FakeMembershipRepository({ users })
  const events = new FakeEventRepository({ memberships, photos })
  const missions = new FakeMissionRepository(photos)
  const challenges = new FakeChallengeRepository(photos)

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
        challengeRoutes({
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
            startChallenge: makeStartChallenge({
              events,
              missions,
              challenges,
              memberships,
              ids: new SequentialIdGenerator(),
              bus: deps.bus,
              clock: deps.clock,
            }),
            getChallenge: makeGetChallenge({
              events,
              challenges,
              memberships,
              clock: deps.clock,
            }),
            stopChallenge: makeStopChallenge({
              events,
              challenges,
              memberships,
              bus: deps.bus,
              clock: deps.clock,
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
  missions.seed(
    aMission({ id: SELFIE, eventId: WEDDING, prompt: 'un selfie avec les mariés' }),
    aMission({ id: GALA_MISSION, eventId: GALA, prompt: 'le discours' }),
  )

  return { app: harness.app, challenges }
}

type Who = 'owner' | 'moderator' | 'gala-owner'

const signedIn = async (world: World, who: Who): Promise<Agent> => {
  const agent = request.agent(world.app)
  await agent.post(`/sign-in/${who}`).expect(204)
  return agent
}

const LAUNCH = { missionId: SELFIE, durationSeconds: 120 }

describe('POST /api/events/:eventSlug/challenge', () => {
  let world: World

  beforeEach(() => {
    world = buildWorld()
  })

  it('lets a moderator launch a challenge and answers 201 with it', async () => {
    const agent = await signedIn(world, 'moderator')

    const response = await agent.post(`/api/events/${SLUG}/challenge`).send(LAUNCH)

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      missionId: SELFIE,
      prompt: 'un selfie avec les mariés',
      startedAt: AT.toISOString(),
      endsAt: new Date(AT.getTime() + 120_000).toISOString(),
      state: 'running',
    })
    expect(await world.challenges.findLatest(WEDDING)).not.toBeNull()
  })

  it('launches a challenge from its own typed text, with no mission', async () => {
    const agent = await signedIn(world, 'moderator')

    const response = await agent
      .post(`/api/events/${SLUG}/challenge`)
      .send({ prompt: 'Un toast à l’objectif', durationSeconds: 60 })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ missionId: null, prompt: 'Un toast à l’objectif' })
  })

  it('keeps the typed text and the mission link when both are sent', async () => {
    const agent = await signedIn(world, 'moderator')

    const response = await agent
      .post(`/api/events/${SLUG}/challenge`)
      .send({ prompt: 'Autre texte', missionId: SELFIE, durationSeconds: 60 })

    expect(response.body).toMatchObject({ missionId: SELFIE, prompt: 'Autre texte' })
  })

  it.each([
    ['neither a text nor a mission', { durationSeconds: 60 }],
    ['an empty text', { prompt: '   ', durationSeconds: 60 }],
    ['a text over sixty characters', { prompt: 'x'.repeat(61), durationSeconds: 60 }],
  ])('answers 400 for %s', async (_name, body) => {
    const agent = await signedIn(world, 'moderator')

    const response = await agent.post(`/api/events/${SLUG}/challenge`).send(body)

    expect(response.status).toBe(400)
    expect(await world.challenges.findLatest(WEDDING)).toBeNull()
  })

  it('answers 409 challenge.alreadyRunning to a second launch', async () => {
    const agent = await signedIn(world, 'owner')
    await agent.post(`/api/events/${SLUG}/challenge`).send(LAUNCH).expect(201)

    const second = await agent.post(`/api/events/${SLUG}/challenge`).send(LAUNCH)

    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('challenge.alreadyRunning')
  })

  it.each([14, 1801])('answers 400 for a duration of %s seconds', async (durationSeconds) => {
    const agent = await signedIn(world, 'owner')

    const response = await agent
      .post(`/api/events/${SLUG}/challenge`)
      .send({ ...LAUNCH, durationSeconds })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('challenge.durationInvalid')
  })

  it('answers 400 for a field it does not know', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent
      .post(`/api/events/${SLUG}/challenge`)
      .send({ ...LAUNCH, endsAt: '2030-01-01T00:00:00Z' })

    expect(response.status).toBe(400)
    expect(await world.challenges.findLatest(WEDDING)).toBeNull()
  })

  it('answers 404 for a mission of another event', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent
      .post(`/api/events/${SLUG}/challenge`)
      .send({ ...LAUNCH, missionId: GALA_MISSION })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('mission.notFound')
  })

  it('answers 401 without a session, as a guest who only holds a token is', async () => {
    const response = await request(world.app).post(`/api/events/${SLUG}/challenge`).send(LAUNCH)

    expect(response.status).toBe(401)
    expect(await world.challenges.findLatest(WEDDING)).toBeNull()
  })

  it('answers 404 for the owner of another event', async () => {
    const agent = await signedIn(world, 'gala-owner')

    const response = await agent.post(`/api/events/${SLUG}/challenge`).send(LAUNCH)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
    expect(await world.challenges.findLatest(WEDDING)).toBeNull()
  })
})

describe('DELETE /api/events/:eventSlug/challenge', () => {
  let world: World

  beforeEach(() => {
    world = buildWorld()
  })

  it('stops the running challenge and answers 204', async () => {
    const agent = await signedIn(world, 'moderator')
    await agent.post(`/api/events/${SLUG}/challenge`).send(LAUNCH).expect(201)

    const response = await agent.delete(`/api/events/${SLUG}/challenge`)

    expect(response.status).toBe(204)
    expect((await world.challenges.findLatest(WEDDING))?.endedAt).not.toBeNull()
  })

  it('answers 204 when nothing is running', async () => {
    const agent = await signedIn(world, 'owner')

    expect((await agent.delete(`/api/events/${SLUG}/challenge`)).status).toBe(204)
  })

  it('answers 401 without a session', async () => {
    expect((await request(world.app).delete(`/api/events/${SLUG}/challenge`)).status).toBe(401)
  })

  it('answers 404 for the owner of another event, and stops nothing', async () => {
    const owner = await signedIn(world, 'owner')
    await owner.post(`/api/events/${SLUG}/challenge`).send(LAUNCH).expect(201)
    const stranger = await signedIn(world, 'gala-owner')

    const response = await stranger.delete(`/api/events/${SLUG}/challenge`)

    expect(response.status).toBe(404)
    expect((await world.challenges.findLatest(WEDDING))?.endedAt).toBeNull()
  })
})

describe('GET /api/events/:eventSlug/challenge', () => {
  let world: World

  beforeEach(() => {
    world = buildWorld()
  })

  it('answers no challenge, with the server clock, before one is launched', async () => {
    const agent = await signedIn(world, 'moderator')

    const response = await agent.get(`/api/events/${SLUG}/challenge`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ challenge: null, serverNowMs: AT.getTime(), recent: [] })
  })

  it('offers the texts of past challenges back to the host, newest first', async () => {
    const agent = await signedIn(world, 'moderator')
    await agent
      .post(`/api/events/${SLUG}/challenge`)
      .send({ prompt: 'Premier', durationSeconds: 60 })
      .expect(201)
    await agent.delete(`/api/events/${SLUG}/challenge`).expect(204)

    const response = await agent.get(`/api/events/${SLUG}/challenge`)

    expect(response.body.recent).toEqual(['Premier'])
  })

  it('answers the running challenge with the mission it names', async () => {
    const agent = await signedIn(world, 'moderator')
    await agent.post(`/api/events/${SLUG}/challenge`).send(LAUNCH).expect(201)

    const response = await agent.get(`/api/events/${SLUG}/challenge`)

    expect(response.body.challenge).toEqual({
      id: expect.any(String),
      missionId: SELFIE,
      prompt: 'un selfie avec les mariés',
      startedAt: AT.toISOString(),
      endsAt: new Date(AT.getTime() + 120_000).toISOString(),
      state: 'running',
      answers: null,
    })
  })

  it('answers 401 without a session', async () => {
    expect((await request(world.app).get(`/api/events/${SLUG}/challenge`)).status).toBe(401)
  })

  it('answers 404 for the owner of another event', async () => {
    const agent = await signedIn(world, 'gala-owner')

    expect((await agent.get(`/api/events/${SLUG}/challenge`)).status).toBe(404)
  })
})
