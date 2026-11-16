import type { Express } from 'express'
import request from '../testing/request'
import type { Agent } from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeCreateAnnouncement } from '../../../application/usecases/announcements/createAnnouncement'
import { makeDeleteAnnouncement } from '../../../application/usecases/announcements/deleteAnnouncement'
import { makeLaunchAnnouncement } from '../../../application/usecases/announcements/launchAnnouncement'
import { makeListAnnouncements } from '../../../application/usecases/announcements/listAnnouncements'
import { makeUpdateAnnouncement } from '../../../application/usecases/announcements/updateAnnouncement'
import { AT, anAnnouncement, anEvent, aUser } from '../../../application/testing/builders'
import { FakeAnnouncementRepository } from '../../../application/testing/fakeAnnouncementRepository'
import type { FakeClock } from '../../../application/testing/fakeClock'
import { FakeEventRepository } from '../../../application/testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../../application/testing/fakeMembershipRepository'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { FakeUserRepository } from '../../../application/testing/fakeUserRepository'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import { asAnnouncementId, asEventId, asUserId } from '../../../domain/shared/ids'
import { buildHarness, signInAs } from '../testing/middlewareHarness'
import type { HttpDeps } from '../types'
import { announcementRoutes } from './announcementRoutes'

/**
 * The scheduled announcement routes (spec 21), driven through a real Express app.
 *
 * Two events with different owners, because the case that catches real incidents is the other
 * event's owner reaching for this one: it answers **404**, not 403.
 */

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const CLOSED = asEventId('evt-closed')

const OWNER = '11111111-1111-4111-8111-111111111111'
const MODERATOR = '22222222-2222-4222-8222-222222222222'
const GALA_OWNER = '33333333-3333-4333-8333-333333333333'

const SLUG = 'camille-et-sacha'
const GALA_SLUG = 'gala-annuel'
const CLOSED_SLUG = 'termine'

const SECOND = 1000
const inSeconds = (seconds: number): string =>
  new Date(AT.getTime() + seconds * SECOND).toISOString()

interface World {
  readonly app: Express
  readonly announcements: FakeAnnouncementRepository
  readonly clock: FakeClock
}

const buildWorld = (): World => {
  const users = new FakeUserRepository()
  const photos = new FakePhotoRepository()
  const memberships = new FakeMembershipRepository({ users })
  const events = new FakeEventRepository({ memberships, photos })
  const announcements = new FakeAnnouncementRepository()
  // Uuid-shaped announcement ids, as the routes parse an id before they look it up.
  const ids = new SequentialIdGenerator()
  let minted = 0
  ids.announcementId = () => {
    minted += 1
    return asAnnouncementId(`00000000-0000-4000-8000-${String(minted).padStart(12, '0')}`)
  }

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
        announcementRoutes({
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
            listAnnouncements: makeListAnnouncements({
              events,
              announcements,
              memberships,
              clock: deps.clock,
            }),
            createAnnouncement: makeCreateAnnouncement({
              events,
              announcements,
              memberships,
              ids,
              bus: deps.bus,
              clock: deps.clock,
            }),
            updateAnnouncement: makeUpdateAnnouncement({
              events,
              announcements,
              memberships,
              bus: deps.bus,
              clock: deps.clock,
            }),
            launchAnnouncement: makeLaunchAnnouncement({
              events,
              announcements,
              memberships,
              bus: deps.bus,
              clock: deps.clock,
            }),
            deleteAnnouncement: makeDeleteAnnouncement({
              events,
              announcements,
              memberships,
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
    anEvent({
      id: CLOSED,
      ownerId: OWNER,
      slug: CLOSED_SLUG,
      joinCode: 'C5M8QR',
      status: 'closed',
    }),
  )
  memberships.seed(
    { eventId: WEDDING, userId: asUserId(OWNER), role: 'owner', grantedAt: AT },
    { eventId: WEDDING, userId: asUserId(MODERATOR), role: 'moderator', grantedAt: AT },
    { eventId: GALA, userId: asUserId(GALA_OWNER), role: 'owner', grantedAt: AT },
    { eventId: CLOSED, userId: asUserId(OWNER), role: 'owner', grantedAt: AT },
  )

  return { app: harness.app, announcements, clock: harness.clock }
}

type Who = 'owner' | 'moderator' | 'gala-owner'

const signedIn = async (world: World, who: Who): Promise<Agent> => {
  const agent = request.agent(world.app)
  await agent.post(`/sign-in/${who}`).expect(204)
  return agent
}

const CAKE = { text: 'Gâteau', at: inSeconds(3600) }
const BASE = `/api/events/${SLUG}/announcements`

describe('POST /api/events/:eventSlug/announcements', () => {
  let world: World

  beforeEach(() => {
    world = buildWorld()
  })

  it('lets a moderator schedule a card and answers 201 with it and its state', async () => {
    const agent = await signedIn(world, 'moderator')

    const response = await agent.post(BASE).send(CAKE)

    expect(response.status).toBe(201)
    expect(response.body).toEqual({
      announcement: {
        id: expect.any(String),
        text: 'Gâteau',
        kind: 'fullscreen',
        at: inSeconds(3600),
        durationSeconds: 30,
        countdownSeconds: 300,
        state: 'upcoming',
      },
    })
    expect(await world.announcements.listByEvent(WEDDING)).toHaveLength(1)
  })

  it('takes the kind in the body, and a discreet announcement lasts 15 minutes with no countdown', async () => {
    const agent = await signedIn(world, 'moderator')

    const response = await agent
      .post(BASE)
      .send({ text: 'Le buffet est ouvert', kind: 'discreet', at: inSeconds(600) })

    expect(response.status).toBe(201)
    expect(response.body.announcement).toMatchObject({
      kind: 'discreet',
      durationSeconds: 900,
      countdownSeconds: 0,
    })
  })

  it('launches on the spot when no moment is sent', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent.post(BASE).send({ text: 'Le gâteau arrive !' })

    expect(response.status).toBe(201)
    expect(response.body.announcement).toMatchObject({
      at: AT.toISOString(),
      countdownSeconds: 0,
      state: 'showing',
    })
  })

  it.each([
    ['an empty text', { text: '  ' }, 'announcement.textInvalid'],
    ['a text of 81 characters', { text: 'x'.repeat(81) }, 'announcement.textInvalid'],
    ['an unknown kind', { ...CAKE, kind: 'banner' }, 'announcement.kindInvalid'],
    ['a moment that is not a date', { ...CAKE, at: 'bientôt' }, 'announcement.atInvalid'],
    ['a moment two minutes ago', { ...CAKE, at: inSeconds(-120) }, 'announcement.atInvalid'],
    [
      'a fullscreen card of 300 s',
      { ...CAKE, durationSeconds: 300 },
      'announcement.durationInvalid',
    ],
    [
      'a discreet announcement of 60 s',
      { ...CAKE, kind: 'discreet', durationSeconds: 60 },
      'announcement.durationInvalid',
    ],
    [
      'a countdown outside the list',
      { ...CAKE, countdownSeconds: 61 },
      'announcement.countdownInvalid',
    ],
    [
      'a discreet announcement with a countdown',
      { ...CAKE, kind: 'discreet', countdownSeconds: 300 },
      'announcement.countdownInvalid',
    ],
  ])('answers 400 %s, naming the code', async (_name, body, code) => {
    const agent = await signedIn(world, 'moderator')

    const response = await agent.post(BASE).send(body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe(code)
    expect(await world.announcements.listByEvent(WEDDING)).toEqual([])
  })

  it('says the limits in the body of a refusal', async () => {
    const agent = await signedIn(world, 'moderator')

    const text = await agent.post(BASE).send({ text: '' })
    const duration = await agent.post(BASE).send({ ...CAKE, durationSeconds: 9 })

    expect(text.body.error.details).toEqual({ max: 80 })
    expect(duration.body.error.details).toEqual({ kind: 'fullscreen', min: 10, max: 120 })
  })

  it('answers 400 for a field it does not know, and for a text far too long', async () => {
    const agent = await signedIn(world, 'moderator')

    const unknown = await agent.post(BASE).send({ ...CAKE, state: 'showing' })
    const huge = await agent.post(BASE).send({ text: 'x'.repeat(201) })

    expect(unknown.status).toBe(400)
    expect(unknown.body.error.code).toBe('request.invalid')
    expect(huge.status).toBe(400)
    expect(await world.announcements.listByEvent(WEDDING)).toEqual([])
  })

  it('answers 409 announcement.overlap for two cards on top of each other', async () => {
    const agent = await signedIn(world, 'moderator')
    await agent.post(BASE).send(CAKE).expect(201)

    const second = await agent.post(BASE).send({ text: 'Discours', at: inSeconds(3629) })

    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('announcement.overlap')
  })

  it('answers 409 announcement.showing to a launch while a card is on screen', async () => {
    const agent = await signedIn(world, 'owner')
    await agent.post(BASE).send({ text: 'Premier' }).expect(201)
    world.clock.advance(5 * SECOND)

    const second = await agent.post(BASE).send({ text: 'Second' })

    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('announcement.showing')
  })

  it('answers 409 announcement.eventNotOpen on a closed event', async () => {
    const agent = await signedIn(world, 'owner')

    const response = await agent.post(`/api/events/${CLOSED_SLUG}/announcements`).send(CAKE)

    expect(response.status).toBe(409)
    expect(response.body.error).toMatchObject({
      code: 'announcement.eventNotOpen',
      details: { status: 'closed' },
    })
  })

  it('answers 401 without a session, as a guest who only holds a token is', async () => {
    const response = await request(world.app).post(BASE).send(CAKE)

    expect(response.status).toBe(401)
    expect(await world.announcements.listByEvent(WEDDING)).toEqual([])
  })

  it('answers 404 for the owner of another event, and writes nothing', async () => {
    const agent = await signedIn(world, 'gala-owner')

    const response = await agent.post(BASE).send(CAKE)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
    expect(await world.announcements.listByEvent(WEDDING)).toEqual([])
  })

  it('limits the writes of one account to sixty a minute, with Retry-After', async () => {
    const agent = await signedIn(world, 'moderator')
    world.announcements.seed(
      anAnnouncement({ id: 'a1', eventId: 'evt-wedding', at: new Date(AT.getTime() + 3600_000) }),
    )

    for (let i = 0; i < 60; i += 1) {
      const sent = await agent.patch(`${BASE}/${uuidOf(1)}`).send({})
      expect(sent.status, `request ${i + 1}`).toBe(404)
    }
    const refused = await agent.patch(`${BASE}/${uuidOf(1)}`).send({})

    expect(refused.status).toBe(429)
    expect(refused.body.error.code).toBe('rate.limited')
    expect(refused.headers['retry-after']).toBeDefined()
  })
})

/** A well-formed id that names nothing. */
const uuidOf = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('GET /api/events/:eventSlug/announcements', () => {
  let world: World

  beforeEach(() => {
    world = buildWorld()
  })

  it('answers an empty list with the server clock before any is scheduled', async () => {
    const agent = await signedIn(world, 'moderator')

    const response = await agent.get(BASE)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ announcements: [], serverNowMs: AT.getTime() })
  })

  it('lists them by moment with their kind and state, including the over ones', async () => {
    const agent = await signedIn(world, 'moderator')
    world.announcements.seed(
      anAnnouncement({
        id: 'past',
        eventId: 'evt-wedding',
        text: 'Passée',
        at: new Date(AT.getTime() - 600_000),
      }),
      anAnnouncement({
        id: 'buffet',
        eventId: 'evt-wedding',
        text: 'Buffet',
        kind: 'discreet',
        at: new Date(AT.getTime() - 5_000),
      }),
      anAnnouncement({
        id: 'later',
        eventId: 'evt-wedding',
        text: 'Plus tard',
        at: new Date(AT.getTime() + 3_600_000),
        countdownSeconds: 300,
      }),
    )

    const response = await agent.get(BASE)

    expect(
      response.body.announcements.map((row: { id: string; kind: string; state: string }) => [
        row.id,
        row.kind,
        row.state,
      ]),
    ).toEqual([
      ['past', 'fullscreen', 'over'],
      ['buffet', 'discreet', 'showing'],
      ['later', 'fullscreen', 'upcoming'],
    ])
  })

  it('answers 401 without a session', async () => {
    expect((await request(world.app).get(BASE)).status).toBe(401)
  })

  it('answers 404 for the owner of another event, and never lists its rows', async () => {
    world.announcements.seed(anAnnouncement({ id: 'a1', eventId: 'evt-wedding' }))
    const agent = await signedIn(world, 'gala-owner')

    const response = await agent.get(BASE)

    expect(response.status).toBe(404)
    expect(JSON.stringify(response.body)).not.toContain('a1')
  })

  it('stays readable on a closed event', async () => {
    const agent = await signedIn(world, 'owner')

    expect((await agent.get(`/api/events/${CLOSED_SLUG}/announcements`)).status).toBe(200)
  })
})

describe('PATCH /api/events/:eventSlug/announcements/:announcementId', () => {
  let world: World

  beforeEach(() => {
    world = buildWorld()
  })

  const schedule = async (agent: Agent, body: object = CAKE): Promise<string> =>
    ((await agent.post(BASE).send(body).expect(201)).body.announcement as { id: string }).id

  it('changes the fields it names and answers 200 with the announcement', async () => {
    const agent = await signedIn(world, 'moderator')
    const id = await schedule(agent)

    const response = await agent
      .patch(`${BASE}/${id}`)
      .send({ text: 'Discours', durationSeconds: 60 })

    expect(response.status).toBe(200)
    expect(response.body.announcement).toMatchObject({
      id,
      text: 'Discours',
      durationSeconds: 60,
      countdownSeconds: 300,
      state: 'upcoming',
    })
  })

  it('moves a card to another kind, with a duration of that kind', async () => {
    const agent = await signedIn(world, 'moderator')
    const id = await schedule(agent)

    const response = await agent
      .patch(`${BASE}/${id}`)
      .send({ kind: 'discreet', durationSeconds: 600 })

    expect(response.body.announcement).toMatchObject({
      kind: 'discreet',
      durationSeconds: 600,
      countdownSeconds: 0,
    })
  })

  it('answers 409 announcement.locked once the card is on screen', async () => {
    const agent = await signedIn(world, 'moderator')
    const id = await schedule(agent, { text: 'Gâteau' })

    const response = await agent.patch(`${BASE}/${id}`).send({ text: 'Autre' })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('announcement.locked')
  })

  it('lets the text of a discreet announcement on screen change, and nothing else', async () => {
    const agent = await signedIn(world, 'moderator')
    const id = await schedule(agent, { text: 'Buffet', kind: 'discreet' })

    const text = await agent.patch(`${BASE}/${id}`).send({ text: 'Buffet ouvert' })
    const moment = await agent.patch(`${BASE}/${id}`).send({ durationSeconds: 1800 })

    expect(text.status).toBe(200)
    expect(text.body.announcement).toMatchObject({ text: 'Buffet ouvert', state: 'showing' })
    expect(moment.status).toBe(409)
    expect(moment.body.error.code).toBe('announcement.locked')
  })

  it('answers 404 announcement.notFound for an identifier of another event', async () => {
    world.announcements.seed(anAnnouncement({ id: uuidOf(7), eventId: 'evt-gala', text: 'Gala' }))
    const agent = await signedIn(world, 'owner')

    const response = await agent.patch(`${BASE}/${uuidOf(7)}`).send({ text: 'Pirate' })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('announcement.notFound')
    expect(
      (await world.announcements.findById(GALA, asAnnouncementId(uuidOf(7))))?.text.value,
    ).toBe('Gala')
  })

  it('answers 400 for an identifier that is not one, and for an unknown field', async () => {
    const agent = await signedIn(world, 'moderator')
    const id = await schedule(agent)

    expect((await agent.patch(`${BASE}/not-an-id`).send({ text: 'x' })).status).toBe(400)
    expect((await agent.patch(`${BASE}/${id}`).send({ state: 'over' })).status).toBe(400)
  })

  it('answers 401 without a session and 404 to the owner of another event', async () => {
    const agent = await signedIn(world, 'moderator')
    const id = await schedule(agent)
    const stranger = await signedIn(world, 'gala-owner')

    expect((await request(world.app).patch(`${BASE}/${id}`).send({})).status).toBe(401)
    expect((await stranger.patch(`${BASE}/${id}`).send({ text: 'x' })).status).toBe(404)
  })
})

describe('POST /api/events/:eventSlug/announcements/:announcementId/launch', () => {
  let world: World

  beforeEach(() => {
    world = buildWorld()
  })

  it('starts the announcement now, without its countdown, and answers 200', async () => {
    const agent = await signedIn(world, 'moderator')
    const id = (await agent.post(BASE).send(CAKE).expect(201)).body.announcement.id as string

    const response = await agent.post(`${BASE}/${id}/launch`)

    expect(response.status).toBe(200)
    expect(response.body.announcement).toMatchObject({
      id,
      at: AT.toISOString(),
      countdownSeconds: 0,
      state: 'showing',
    })
  })

  it('answers 409 announcement.showing when it is on screen already', async () => {
    const agent = await signedIn(world, 'moderator')
    const id = (await agent.post(BASE).send({ text: 'Gâteau' }).expect(201)).body.announcement
      .id as string

    const response = await agent.post(`${BASE}/${id}/launch`)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('announcement.showing')
  })

  it('answers 404 for an unknown identifier, 401 without a session, 404 to a stranger', async () => {
    const stranger = await signedIn(world, 'gala-owner')

    expect(
      (await (await signedIn(world, 'owner')).post(`${BASE}/${uuidOf(9)}/launch`)).status,
    ).toBe(404)
    expect((await request(world.app).post(`${BASE}/${uuidOf(9)}/launch`)).status).toBe(401)
    expect((await stranger.post(`${BASE}/${uuidOf(9)}/launch`)).status).toBe(404)
  })
})

describe('DELETE /api/events/:eventSlug/announcements/:announcementId', () => {
  let world: World

  beforeEach(() => {
    world = buildWorld()
  })

  it('deletes an announcement and answers 204; a second delete is 404', async () => {
    const agent = await signedIn(world, 'moderator')
    const id = (await agent.post(BASE).send(CAKE).expect(201)).body.announcement.id as string

    const first = await agent.delete(`${BASE}/${id}`)
    const second = await agent.delete(`${BASE}/${id}`)

    expect(first.status).toBe(204)
    expect(second.status).toBe(404)
    expect(second.body.error.code).toBe('announcement.notFound')
    expect(await world.announcements.listByEvent(WEDDING)).toEqual([])
  })

  it('answers 401 without a session and 404 to the owner of another event, and deletes nothing', async () => {
    const agent = await signedIn(world, 'moderator')
    const id = (await agent.post(BASE).send(CAKE).expect(201)).body.announcement.id as string
    const stranger = await signedIn(world, 'gala-owner')

    expect((await request(world.app).delete(`${BASE}/${id}`)).status).toBe(401)
    expect((await stranger.delete(`${BASE}/${id}`)).status).toBe(404)
    expect(await world.announcements.listByEvent(WEDDING)).toHaveLength(1)
  })

  it('never deletes a row of another event, even with its identifier', async () => {
    world.announcements.seed(anAnnouncement({ id: uuidOf(5), eventId: 'evt-gala' }))
    const agent = await signedIn(world, 'owner')

    const response = await agent.delete(`${BASE}/${uuidOf(5)}`)

    expect(response.status).toBe(404)
    expect(await world.announcements.listByEvent(GALA)).toHaveLength(1)
  })
})
