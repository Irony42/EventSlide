import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Express } from 'express'
import request, { type Agent } from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeCreateMission } from '../../../application/usecases/missions/createMission'
import { makeDeleteMission } from '../../../application/usecases/missions/deleteMission'
import { makeListMissions } from '../../../application/usecases/missions/listMissions'
import { makeUpdateMission } from '../../../application/usecases/missions/updateMission'
import { AT, aMission, aPhoto, anEvent, aUser } from '../../../application/testing/builders'
import { FakeEventRepository } from '../../../application/testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../../application/testing/fakeMembershipRepository'
import { FakeMissionRepository } from '../../../application/testing/fakeMissionRepository'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { FakeUserRepository } from '../../../application/testing/fakeUserRepository'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import { MAX_MISSIONS_PER_EVENT } from '../../../domain/missions/mission'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { buildHarness, signInAs } from '../testing/middlewareHarness'
import type { HttpDeps } from '../types'
import { missionRoutes } from './missionRoutes'

/**
 * The host's mission list, driven through a real Express app.
 *
 * Two events with different owners in every test, because the case that catches real
 * incidents is the gala's owner reaching for the wedding — which must answer **404**
 * rather than 403, since a 403 confirms the event exists and turns this into an
 * enumeration oracle over other people's weddings.
 */

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

/** UUIDs, because `missionParams` parses `:missionId` as one. */
const OWNER = '11111111-1111-4111-8111-111111111111'
const MODERATOR = '22222222-2222-4222-8222-222222222222'
const GALA_OWNER = '33333333-3333-4333-8333-333333333333'
const NEWCOMER = '44444444-4444-4444-8444-444444444444'

const SELFIE = '55555555-5555-4555-8555-555555555555'
const FIRST_DANCE = '66666666-6666-4666-8666-666666666666'
const GALA_MISSION = '77777777-7777-4777-8777-777777777777'
const NO_SUCH_MISSION = '88888888-8888-4888-8888-888888888888'

const SLUG = 'camille-et-sacha'
const GALA_SLUG = 'gala-annuel'

interface World {
  readonly app: Express
  readonly events: FakeEventRepository
  readonly missions: FakeMissionRepository
  readonly photos: FakePhotoRepository
}

const buildWorld = (): World => {
  const users = new FakeUserRepository()
  const photos = new FakePhotoRepository()
  const memberships = new FakeMembershipRepository({ users })
  const events = new FakeEventRepository({ memberships, photos })
  const missions = new FakeMissionRepository(photos)

  const harness = buildHarness({
    routes: (app, harnessDeps) => {
      const deps: HttpDeps = { ...harnessDeps, events, memberships, users }

      app.post('/sign-in/owner', signInAs({ userId: OWNER, email: 'hote@example.test' }))
      app.post(
        '/sign-in/moderator',
        signInAs({ userId: MODERATOR, email: 'moderateur@example.test' }),
      )
      app.post('/sign-in/gala-owner', signInAs({ userId: GALA_OWNER, email: 'gala@example.test' }))
      app.post('/sign-in/newcomer', signInAs({ userId: NEWCOMER, email: 'nouvelle@example.test' }))

      app.use(
        '/api',
        missionRoutes({
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
          // Exactly the four this router declares, which is what `MissionRouteDeps`
          // being a `Pick` buys: a bag of thirty stubs would prove nothing about which
          // of them this surface can reach.
          usecases: {
            listMissions: makeListMissions({ events, missions, memberships }),
            createMission: makeCreateMission({
              events,
              missions,
              memberships,
              ids: new SequentialIdGenerator(),
              bus: deps.bus,
              clock: deps.clock,
            }),
            updateMission: makeUpdateMission({ events, missions, memberships, bus: deps.bus }),
            deleteMission: makeDeleteMission({ events, missions, memberships, bus: deps.bus }),
          },
        }),
      )
    },
  })

  users.seed(
    aUser({ id: OWNER, email: 'hote@example.test' }),
    aUser({ id: MODERATOR, email: 'moderateur@example.test' }),
    aUser({ id: GALA_OWNER, email: 'gala@example.test' }),
    aUser({ id: NEWCOMER, email: 'nouvelle@example.test' }),
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
    aMission({
      id: FIRST_DANCE,
      eventId: WEDDING,
      prompt: 'la première danse',
      scope: 'event',
      createdAt: new Date(AT.getTime() + 1_000),
    }),
    aMission({ id: GALA_MISSION, eventId: GALA, prompt: 'le discours' }),
  )

  return { app: harness.app, events, missions, photos }
}

type Who = 'owner' | 'moderator' | 'gala-owner' | 'newcomer'

const signedIn = async (world: World, who: Who): Promise<Agent> => {
  const agent = request.agent(world.app)
  await agent.post(`/sign-in/${who}`).expect(204)
  return agent
}

const A_PROMPT = { prompt: 'quelqu’un qui pleure', scope: 'guest' } as const

describe('GET /api/events/:eventSlug/missions', () => {
  let world: World

  beforeEach(() => {
    world = buildWorld()
  })

  it('lists the prompts in the order the host wrote them', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent.get(`/api/events/${SLUG}/missions`)

    expect(response.status).toBe(200)
    expect(response.body.items.map((row: { prompt: string }) => row.prompt)).toEqual([
      'un selfie avec les mariés',
      'la première danse',
    ])
  })

  it('carries the counts, which are derived rather than stored', async () => {
    world.photos.seed(
      aPhoto({ id: 'photo-1', eventId: WEDDING, status: 'published', missionId: SELFIE }),
    )
    const agent = await signedIn(world, 'owner')

    const response = await agent.get(`/api/events/${SLUG}/missions`)

    expect(response.body.items[0]).toMatchObject({
      achieved: true,
      publishedPhotos: 1,
      completedByGuests: 1,
    })
  })

  it('does not count a photograph the host refused', async () => {
    // The wire half of the hardest rule in roadmap §2.1: a tag is a claim, publishing is
    // the verdict, and only the verdict reaches this response.
    world.photos.seed(
      aPhoto({ id: 'photo-1', eventId: WEDDING, status: 'rejected', missionId: SELFIE }),
    )
    const agent = await signedIn(world, 'owner')

    const response = await agent.get(`/api/events/${SLUG}/missions`)

    expect(response.body.items[0]).toMatchObject({ achieved: false, publishedPhotos: 0 })
  })

  it('shows a moderator the list', async () => {
    const agent = await signedIn(world, 'moderator')

    expect((await agent.get(`/api/events/${SLUG}/missions`)).status).toBe(200)
  })

  it('answers 401 without a session', async () => {
    const response = await request(world.app).get(`/api/events/${SLUG}/missions`)

    expect(response.status).toBe(401)
  })

  it('answers 404 for the owner of another event', async () => {
    const agent = await signedIn(world, 'gala-owner')

    const response = await agent.get(`/api/events/${SLUG}/missions`)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })

  it('never leaks another event"s prompt into this list', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent.get(`/api/events/${SLUG}/missions`)

    expect(JSON.stringify(response.body)).not.toContain('le discours')
  })
})

describe('POST /api/events/:eventSlug/missions', () => {
  let world: World

  beforeEach(() => {
    world = buildWorld()
  })

  it('creates the prompt and answers 201 with the row', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent.post(`/api/events/${SLUG}/missions`).send(A_PROMPT)

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      prompt: 'quelqu’un qui pleure',
      scope: 'guest',
      achieved: false,
      publishedPhotos: 0,
      completedByGuests: 0,
    })
    expect(await world.missions.count(WEDDING)).toBe(3)
  })

  it('answers 401 without a session', async () => {
    const response = await request(world.app).post(`/api/events/${SLUG}/missions`).send(A_PROMPT)

    expect(response.status).toBe(401)
  })

  it('answers 403 for a moderator, who may read the list and not write it', async () => {
    const agent = await signedIn(world, 'moderator')

    const response = await agent.post(`/api/events/${SLUG}/missions`).send(A_PROMPT)

    expect(response.status).toBe(403)
    expect(await world.missions.count(WEDDING)).toBe(2)
  })

  it('answers 404 for the owner of another event', async () => {
    const agent = await signedIn(world, 'gala-owner')

    const response = await agent.post(`/api/events/${SLUG}/missions`).send(A_PROMPT)

    expect(response.status).toBe(404)
    expect(await world.missions.count(WEDDING)).toBe(2)
  })

  it('answers 400 for a scope outside the enum', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent
      .post(`/api/events/${SLUG}/missions`)
      .send({ prompt: 'un selfie', scope: 'room' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('answers 400 for a body carrying a key this contract does not have', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent
      .post(`/api/events/${SLUG}/missions`)
      .send({ ...A_PROMPT, completedByGuests: 99 })

    expect(response.status).toBe(400)
  })

  it('answers 400 for a prompt the domain refuses', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent
      .post(`/api/events/${SLUG}/missions`)
      .send({ ...A_PROMPT, prompt: '   ' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('mission.promptEmpty')
  })

  it('answers 409 for a prompt this event already holds', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent
      .post(`/api/events/${SLUG}/missions`)
      .send({ prompt: 'un selfie avec les mariés', scope: 'guest' })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('mission.duplicate')
  })

  it('answers 409 past the ceiling, naming the limit', async () => {
    const agent = await signedIn(world, 'owner')
    for (let index = 2; index < MAX_MISSIONS_PER_EVENT; index += 1) {
      await agent
        .post(`/api/events/${SLUG}/missions`)
        .send({ prompt: `prompt ${index}`, scope: 'guest' })
        .expect(201)
    }

    const response = await agent.post(`/api/events/${SLUG}/missions`).send(A_PROMPT)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('mission.limitReached')
    expect(response.body.error.details).toEqual({ max: MAX_MISSIONS_PER_EVENT })
  })
})

describe('PATCH /api/events/:eventSlug/missions/:missionId', () => {
  let world: World

  beforeEach(() => {
    world = buildWorld()
  })

  it('corrects the prompt and answers 204', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent
      .patch(`/api/events/${SLUG}/missions/${SELFIE}`)
      .send({ prompt: 'un selfie avec les mariées', scope: 'event' })

    expect(response.status).toBe(204)
    const listed = await world.missions.listWithProgress(WEDDING)
    expect(listed[0]?.mission.prompt.value).toBe('un selfie avec les mariées')
    expect(listed[0]?.mission.scope).toBe('event')
  })

  it('answers 401 without a session', async () => {
    const response = await request(world.app)
      .patch(`/api/events/${SLUG}/missions/${SELFIE}`)
      .send(A_PROMPT)

    expect(response.status).toBe(401)
  })

  it('answers 403 for a moderator', async () => {
    const agent = await signedIn(world, 'moderator')

    const response = await agent.patch(`/api/events/${SLUG}/missions/${SELFIE}`).send(A_PROMPT)

    expect(response.status).toBe(403)
  })

  it('answers 404 for the owner of another event', async () => {
    const agent = await signedIn(world, 'gala-owner')

    const response = await agent.patch(`/api/events/${SLUG}/missions/${SELFIE}`).send(A_PROMPT)

    expect(response.status).toBe(404)
  })

  it('answers 404 for a mission that belongs to another event', async () => {
    // The tenant case that matters here: a well-formed id from an event the caller does
    // own, aimed at one they also own. The scoped lookup is what refuses it.
    const agent = await signedIn(world, 'owner')

    const response = await agent
      .patch(`/api/events/${SLUG}/missions/${GALA_MISSION}`)
      .send(A_PROMPT)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('mission.notFound')
    expect((await world.missions.listWithProgress(GALA))[0]?.mission.prompt.value).toBe(
      'le discours',
    )
  })

  it('answers 404 for a mission that does not exist', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent
      .patch(`/api/events/${SLUG}/missions/${NO_SUCH_MISSION}`)
      .send(A_PROMPT)

    expect(response.status).toBe(404)
  })

  it('answers 400 for a mission id that is not a uuid, before it reaches a query', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent.patch(`/api/events/${SLUG}/missions/pas-un-uuid`).send(A_PROMPT)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('answers 400 for a body missing the scope', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent
      .patch(`/api/events/${SLUG}/missions/${SELFIE}`)
      .send({ prompt: 'un selfie' })

    expect(response.status).toBe(400)
  })

  it('answers 409 for a prompt another mission of this event holds', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent
      .patch(`/api/events/${SLUG}/missions/${SELFIE}`)
      .send({ prompt: 'la première danse', scope: 'guest' })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('mission.duplicate')
  })
})

describe('DELETE /api/events/:eventSlug/missions/:missionId', () => {
  let world: World

  beforeEach(() => {
    world = buildWorld()
  })

  it('removes the prompt and answers 204', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent.delete(`/api/events/${SLUG}/missions/${SELFIE}`)

    expect(response.status).toBe(204)
    expect(await world.missions.count(WEDDING)).toBe(1)
  })

  it('keeps every photograph that was filed under it', async () => {
    world.photos.seed(
      aPhoto({ id: 'photo-1', eventId: WEDDING, status: 'published', missionId: SELFIE }),
    )
    const agent = await signedIn(world, 'owner')

    await agent.delete(`/api/events/${SLUG}/missions/${SELFIE}`).expect(204)

    const remaining = world.photos.ofEvent(WEDDING)
    expect(remaining.map((photo) => [photo.id, photo.missionId])).toEqual([['photo-1', null]])
  })

  it('answers 401 without a session', async () => {
    const response = await request(world.app).delete(`/api/events/${SLUG}/missions/${SELFIE}`)

    expect(response.status).toBe(401)
  })

  it('answers 403 for a moderator', async () => {
    const agent = await signedIn(world, 'moderator')

    const response = await agent.delete(`/api/events/${SLUG}/missions/${SELFIE}`)

    expect(response.status).toBe(403)
    expect(await world.missions.count(WEDDING)).toBe(2)
  })

  it('answers 404 for the owner of another event', async () => {
    const agent = await signedIn(world, 'gala-owner')

    const response = await agent.delete(`/api/events/${SLUG}/missions/${SELFIE}`)

    expect(response.status).toBe(404)
    expect(await world.missions.count(WEDDING)).toBe(2)
  })

  it('cannot delete another event"s mission through an event it owns', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent.delete(`/api/events/${SLUG}/missions/${GALA_MISSION}`)

    expect(response.status).toBe(404)
    expect(await world.missions.count(GALA)).toBe(1)
  })

  it('answers 400 for a mission id that is not a uuid', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent.delete(`/api/events/${SLUG}/missions/pas-un-uuid`)

    expect(response.status).toBe(400)
  })
})

/**
 * The one number this feature says twice, held together.
 *
 * `MAX_MISSIONS_PER_EVENT` is a domain rule and `POST` above enforces it. The host's panel
 * has to say it as well — it disables the form at the ceiling and prints the limit — and
 * it cannot import it: `web/` and `src/` are separate tsconfig projects and the
 * architecture rule forbids the web app reaching into the server. That is the same trade
 * `presenters/dtoContract.test.ts` makes about the wire format, and this is its shape for
 * one constant.
 *
 * Without it, lowering the domain constant leaves the console offering a thirteenth row
 * that this route answers `409 mission.limitReached`, with nothing failing — a host typing
 * a prompt into a form that cannot accept it. The panel's comment says "Restated so the
 * panel can say it", and a rule restated in a comment with no failing test is the one
 * defect this codebase produces over and over.
 *
 * Reading a path is not an import: nothing here couples the server's build to the web app's.
 */
describe('the mission ceiling, on both sides of the boundary', () => {
  it('is the same number in the domain and in the host panel', () => {
    const source = readFileSync(
      join(process.cwd(), 'web/src/features/admin/MissionsPanel.tsx'),
      'utf8',
    )
    const declared = /const MAX_MISSIONS = ([0-9]+)/.exec(source)

    // A parse that found nothing would make the assertion below vacuous, so it is checked
    // first: the constant may be renamed, but not silently.
    expect(declared, 'MissionsPanel no longer declares `const MAX_MISSIONS`').not.toBeNull()
    expect(Number(declared?.[1])).toBe(MAX_MISSIONS_PER_EVENT)
  })
})
