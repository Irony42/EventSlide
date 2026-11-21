import type { Express } from 'express'
import request from '../testing/request'
import type { Agent } from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeDisableGuestInvite } from '../../../application/usecases/guestInvites/disableGuestInvite'
import { makeEnableGuestInvite } from '../../../application/usecases/guestInvites/enableGuestInvite'
import { makeGetGuestInvite } from '../../../application/usecases/guestInvites/getGuestInvite'
import { makeRotateGuestInviteToken } from '../../../application/usecases/guestInvites/rotateGuestInviteToken'
import { makeSaveGuestInvite } from '../../../application/usecases/guestInvites/saveGuestInvite'
import { AT, anEvent, aUser } from '../../../application/testing/builders'
import { FakeAuditLog } from '../../../application/testing/fakeAuditLog'
import { FakeEventRepository } from '../../../application/testing/fakeEventRepository'
import { FakeGuestInviteRepository } from '../../../application/testing/fakeGuestInviteRepository'
import { FakeMembershipRepository } from '../../../application/testing/fakeMembershipRepository'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { FakeUserRepository } from '../../../application/testing/fakeUserRepository'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { buildHarness, signInAs } from '../testing/middlewareHarness'
import type { HttpDeps } from '../types'
import { guestInviteRoutes } from './guestInviteRoutes'

/**
 * The host's guest invitation routes (spec 29), driven through a real Express app.
 *
 * Two events with different owners, because the case that catches real incidents is the other
 * event's owner reaching for this one: it answers **404**, not 403. The invitation is the owner's:
 * a moderator of the same event is **403**.
 */

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const ARCHIVED = asEventId('evt-archived')

const OWNER = '11111111-1111-4111-8111-111111111111'
const MODERATOR = '22222222-2222-4222-8222-222222222222'
const GALA_OWNER = '33333333-3333-4333-8333-333333333333'

const SLUG = 'camille-et-sacha'
const BASE = `/api/events/${SLUG}/guest-invite`
const PUBLIC_URL = 'http://localhost:4300'

interface World {
  readonly app: Express
  readonly invites: FakeGuestInviteRepository
  readonly audit: FakeAuditLog
}

const buildWorld = (): World => {
  const users = new FakeUserRepository()
  const photos = new FakePhotoRepository()
  const memberships = new FakeMembershipRepository({ users })
  const events = new FakeEventRepository({ memberships, photos })
  const invites = new FakeGuestInviteRepository()
  const audit = new FakeAuditLog().withAccounts(
    asUserId(OWNER),
    asUserId(MODERATOR),
    asUserId(GALA_OWNER),
  )
  const ids = new SequentialIdGenerator()

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
        guestInviteRoutes({
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
            getGuestInvite: makeGetGuestInvite({ events, memberships, invites }),
            saveGuestInvite: makeSaveGuestInvite({
              events,
              memberships,
              invites,
              audit,
              ids,
              clock: deps.clock,
            }),
            enableGuestInvite: makeEnableGuestInvite({
              events,
              memberships,
              invites,
              audit,
              ids,
              clock: deps.clock,
            }),
            disableGuestInvite: makeDisableGuestInvite({
              events,
              memberships,
              invites,
              audit,
              clock: deps.clock,
            }),
            rotateGuestInviteToken: makeRotateGuestInviteToken({
              events,
              memberships,
              invites,
              audit,
              ids,
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
    anEvent({
      id: WEDDING,
      ownerId: OWNER,
      slug: SLUG,
      joinCode: 'H7K2QM',
      name: 'Léa fête ses 40 ans',
      startsAt: new Date('2026-12-13T18:00:00Z'),
      settings: { wallLanguage: 'de' },
    }),
    anEvent({ id: GALA, ownerId: GALA_OWNER, slug: 'gala-annuel', joinCode: 'Z3N9PT' }),
    anEvent({
      id: ARCHIVED,
      ownerId: OWNER,
      slug: 'archive',
      joinCode: 'D6P7RS',
      status: 'archived',
    }),
  )
  memberships.seed(
    { eventId: WEDDING, userId: asUserId(OWNER), role: 'owner', grantedAt: AT },
    { eventId: WEDDING, userId: asUserId(MODERATOR), role: 'moderator', grantedAt: AT },
    { eventId: GALA, userId: asUserId(GALA_OWNER), role: 'owner', grantedAt: AT },
    { eventId: ARCHIVED, userId: asUserId(OWNER), role: 'owner', grantedAt: AT },
  )

  return { app: harness.app, invites, audit }
}

type Who = 'owner' | 'moderator' | 'gala-owner'

const signedIn = async (world: World, who: Who): Promise<Agent> => {
  const agent = request.agent(world.app)
  await agent.post(`/sign-in/${who}`).expect(204)
  return agent
}

const PARTY = {
  title: 'Léa fête ses 40 ans',
  startsAt: '2026-12-13T18:00:00Z',
  endsAt: '2026-12-14T01:00:00Z',
  timeZone: 'Europe/Paris',
  venueName: 'Salle des fêtes de Plouër',
  address: '1 rue de la Gare\n22100 Plouër',
  message: 'Venez comme vous êtes.',
  language: 'fr',
}

describe('GET /api/events/:eventSlug/guest-invite', () => {
  let world: World

  beforeEach(() => {
    world = buildWorld()
  })

  it('answers an unconfigured invitation, with the event’s own name and date to start from, and creates nothing', async () => {
    const response = await (await signedIn(world, 'owner')).get(BASE)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      guestInvite: {
        configured: false,
        enabled: false,
        url: null,
        title: null,
        startsAt: null,
        endsAt: null,
        timeZone: null,
        venueName: null,
        address: null,
        message: null,
        language: 'de',
        defaultTitle: 'Léa fête ses 40 ans',
        defaultStartsAt: '2026-12-13T18:00:00.000Z',
      },
    })
    expect(await world.invites.findByEvent(WEDDING)).toBeNull()
  })

  it('answers the saved invitation with its absolute link', async () => {
    const agent = await signedIn(world, 'owner')
    await agent.put(BASE).send(PARTY).expect(200)

    const response = await agent.get(BASE)

    expect(response.status).toBe(200)
    expect(response.body.guestInvite).toMatchObject({
      configured: true,
      enabled: false,
      ...PARTY,
      startsAt: '2026-12-13T18:00:00.000Z',
      endsAt: '2026-12-14T01:00:00.000Z',
    })
    const stored = await world.invites.findByEvent(WEDDING)
    expect(response.body.guestInvite.url).toBe(`${PUBLIC_URL}/i/${stored?.token.value}`)
  })

  it('answers 401 without a session', async () => {
    const response = await request(world.app).get(BASE)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('answers 404, never 403, for the owner of another event', async () => {
    const response = await (await signedIn(world, 'gala-owner')).get(BASE)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })

  it('is the owner’s: a moderator of the same event is 403', async () => {
    const response = await (await signedIn(world, 'moderator')).get(BASE)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('auth.forbidden')
  })
})

describe('PUT /api/events/:eventSlug/guest-invite', () => {
  let world: World

  beforeEach(() => {
    world = buildWorld()
  })

  it('saves the invitation, switched off, and answers it with a link', async () => {
    const response = await (await signedIn(world, 'owner')).put(BASE).send(PARTY)

    expect(response.status).toBe(200)
    expect(response.body.guestInvite).toMatchObject({ configured: true, enabled: false })
    expect(response.body.guestInvite.url).toMatch(new RegExp(`^${PUBLIC_URL}/i/[0-9A-Z]{16}$`))
    expect((await world.invites.findByEvent(WEDDING))?.content.venueName).toBe(
      'Salle des fêtes de Plouër',
    )
  })

  it('leaves an absent field as it was and clears one sent as null', async () => {
    const agent = await signedIn(world, 'owner')
    await agent.put(BASE).send(PARTY).expect(200)

    const response = await agent.put(BASE).send({ message: null, title: 'Autre titre' })

    expect(response.body.guestInvite).toMatchObject({
      title: 'Autre titre',
      message: null,
      venueName: 'Salle des fêtes de Plouër',
    })
  })

  it.each([
    ['a title of 81 characters', { title: 'x'.repeat(81) }, 'guestInvite.titleTooLong'],
    [
      'an end before the start',
      { ...PARTY, endsAt: '2026-12-13T17:00:00Z' },
      'guestInvite.endBeforeStart',
    ],
    ['a zone nobody knows', { ...PARTY, timeZone: 'Mars/Olympus' }, 'guestInvite.badTimeZone'],
    ['a start with no zone', { startsAt: '2026-12-13T18:00:00Z' }, 'guestInvite.timeZoneRequired'],
    [
      'a bare local start',
      { startsAt: '2026-12-13T19:00', timeZone: 'UTC' },
      'guestInvite.startsAtInvalid',
    ],
    ['a word of 501 characters', { message: 'x'.repeat(501) }, 'guestInvite.messageTooLong'],
    ['an address of three lines', { address: 'a\nb\nc' }, 'guestInvite.addressTooManyLines'],
    ['a language we do not speak', { language: 'pt' }, 'guestInvite.languageInvalid'],
  ])('answers 400 with the domain’s code for %s', async (_name, body, code) => {
    const response = await (await signedIn(world, 'owner')).put(BASE).send(body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe(code)
    expect(await world.invites.findByEvent(WEDDING)).toBeNull()
  })

  it('answers 400 request.invalid for a key the schema does not know', async () => {
    const response = await (await signedIn(world, 'owner')).put(BASE).send({ token: 'AAAA' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('answers 400 request.invalid for a field of the wrong type', async () => {
    const response = await (await signedIn(world, 'owner')).put(BASE).send({ title: 3 })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('is the owner’s: a moderator is 403 and nothing is written', async () => {
    const response = await (await signedIn(world, 'moderator')).put(BASE).send(PARTY)

    expect(response.status).toBe(403)
    expect(await world.invites.findByEvent(WEDDING)).toBeNull()
  })

  it('answers 404 for the owner of another event, and writes nothing for either', async () => {
    const response = await (await signedIn(world, 'gala-owner')).put(BASE).send(PARTY)

    expect(response.status).toBe(404)
    expect(await world.invites.findByEvent(WEDDING)).toBeNull()
    expect(await world.invites.findByEvent(GALA)).toBeNull()
  })

  it('refuses an archived event with 409 guestInvite.eventArchived', async () => {
    const response = await (
      await signedIn(world, 'owner')
    )
      .put('/api/events/archive/guest-invite')
      .send(PARTY)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('guestInvite.eventArchived')
  })

  it('answers 401 without a session', async () => {
    const response = await request(world.app).put(BASE).send(PARTY)

    expect(response.status).toBe(401)
  })

  it('leaves one audit line per save, with no content in it', async () => {
    await (await signedIn(world, 'owner')).put(BASE).send(PARTY)

    const lines = (await world.audit.list({ limit: 10 })).items
    expect(lines.map((line) => line.action)).toEqual(['event.guestInviteSaved'])
    expect(JSON.stringify(lines)).not.toContain('Plouër')
  })
})

describe('POST /api/events/:eventSlug/guest-invite/{enable,disable,rotate}', () => {
  let world: World

  beforeEach(() => {
    world = buildWorld()
  })

  it('switches the link on, off, and on again with the same link', async () => {
    const agent = await signedIn(world, 'owner')
    const saved = await agent.put(BASE).send(PARTY)
    const url = saved.body.guestInvite.url

    const on = await agent.post(`${BASE}/enable`).send({})
    const off = await agent.post(`${BASE}/disable`).send({})
    const back = await agent.post(`${BASE}/enable`).send({})

    expect(on.body.guestInvite).toMatchObject({ enabled: true, url })
    expect(off.body.guestInvite).toMatchObject({ enabled: false, url })
    expect(back.body.guestInvite).toMatchObject({ enabled: true, url })
  })

  it('refuses to switch on an invitation with no date: 400 guestInvite.needsDate', async () => {
    const agent = await signedIn(world, 'owner')
    await agent.put(BASE).send({ title: 'Fête' })

    const response = await agent.post(`${BASE}/enable`).send({})

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('guestInvite.needsDate')
  })

  it('changes the link: a new url, the switch untouched, the old token gone from the store', async () => {
    const agent = await signedIn(world, 'owner')
    const saved = await agent.put(BASE).send(PARTY)
    await agent.post(`${BASE}/enable`).send({})
    const before = await world.invites.findByEvent(WEDDING)

    const rotated = await agent.post(`${BASE}/rotate`).send({})

    expect(rotated.status).toBe(200)
    expect(rotated.body.guestInvite.enabled).toBe(true)
    expect(rotated.body.guestInvite.url).not.toBe(saved.body.guestInvite.url)
    expect(before && (await world.invites.findByToken(before.token))).toBeNull()
  })

  it.each(['disable', 'rotate'])(
    'answers 404 guestInvite.notFound to %s before anything is saved',
    async (act) => {
      const response = await (await signedIn(world, 'owner')).post(`${BASE}/${act}`).send({})

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('guestInvite.notFound')
    },
  )

  it.each(['enable', 'disable', 'rotate'])(
    '%s: a moderator is 403, the owner of another event 404, nobody 401',
    async (act) => {
      expect(
        (await (await signedIn(world, 'moderator')).post(`${BASE}/${act}`).send({})).status,
      ).toBe(403)
      expect(
        (await (await signedIn(world, 'gala-owner')).post(`${BASE}/${act}`).send({})).status,
      ).toBe(404)
      expect((await request(world.app).post(`${BASE}/${act}`).send({})).status).toBe(401)
    },
  )

  it.each(['enable', 'disable', 'rotate'])(
    '%s: a body with a key is a 400, the act is the path',
    async (act) => {
      const response = await (
        await signedIn(world, 'owner')
      )
        .post(`${BASE}/${act}`)
        .send({ token: 'x' })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('request.invalid')
    },
  )
})
