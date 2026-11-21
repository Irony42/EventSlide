import request from '../testing/request'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeGetGuestInviteLogoMedia } from '../../../application/usecases/guestInvites/getGuestInviteLogoMedia'
import { makeViewGuestInvite } from '../../../application/usecases/guestInvites/viewGuestInvite'
import { AT, aGuestInvite, anEvent } from '../../../application/testing/builders'
import { FakeEventRepository } from '../../../application/testing/fakeEventRepository'
import { FakeGuestInviteRepository } from '../../../application/testing/fakeGuestInviteRepository'
import { InMemoryMediaStore } from '../../../application/testing/inMemoryMediaStore'
import { Event } from '../../../domain/events/event'
import { ContentHash } from '../../../domain/photos/contentHash'
import { EVENT_LOGO } from '../../../domain/photos/mediaVariant'
import { asEventId } from '../../../domain/shared/ids'
import { buildServerHarness } from '../testing/serverHarness'

/**
 * The public page of a guest invitation (spec 29), through the real server so that the headers
 * mounted ahead of the body parser are the ones under test. The use cases are the real ones over
 * fakes; every other one is `notWired`.
 *
 * The case that catches real incidents is **the refusal**: a token that is unknown, malformed,
 * too long, switched off, or whose event is archived must be one and the same `404`, byte for byte,
 * because any difference confirms that a guess was close.
 */

const LIVE = asEventId('evt-live')
const DRAFT = asEventId('evt-draft')
const CLOSED = asEventId('evt-closed')
const ARCHIVED = asEventId('evt-archived')

const LOGO = (() => {
  const made = ContentHash.create('a1'.padEnd(64, '0'))
  if (!made.ok) throw new Error('digest')
  return made.value
})()

/** One byte repeated: tokenOf(7) is the sixteen sevens of `aGuestInvite({ tokenByte: 7 })`. */
const token = (byte: number): string => String(byte % 10).repeat(16)
const LIVE_TOKEN = token(1)
const DRAFT_TOKEN = token(2)
const CLOSED_TOKEN = token(3)
const ARCHIVED_TOKEN = token(4)
const OFF_TOKEN = token(5)

const PARTY = {
  title: 'Léa fête ses 40 ans',
  startsAt: '2026-12-13T18:00:00Z',
  endsAt: '2026-12-14T01:00:00Z',
  timeZone: 'Europe/Paris',
  venueName: 'Salle des fêtes',
  address: '1 rue de la Gare',
  message: 'Venez comme vous êtes.',
  language: 'de' as const,
}

interface World {
  readonly app: ReturnType<typeof buildServerHarness>['app']
  readonly media: InMemoryMediaStore
  readonly events: FakeEventRepository
}

const buildWorld = async (perMinute = 200): Promise<World> => {
  const events = new FakeEventRepository()
  const invites = new FakeGuestInviteRepository()
  const media = new InMemoryMediaStore()

  const seed = (
    id: ReturnType<typeof asEventId>,
    slug: string,
    code: string,
    status: Parameters<typeof anEvent>[0],
  ) => {
    events.seed(anEvent({ id, slug, joinCode: code, ...status }))
  }
  seed(LIVE, 'vive', 'H7K2QM', { status: 'live' })
  seed(DRAFT, 'brouillon', 'B4N9PT', { status: 'draft' })
  seed(CLOSED, 'termine', 'C5M8QR', { status: 'closed' })
  seed(ARCHIVED, 'archive', 'D6P7RS', { status: 'archived' })

  const withLogo = (await events.findById(DRAFT)) as Event
  events.seed(Event.restore({ ...withLogo.toProps(), settings: withLogo.settings.withLogo(LOGO) }))
  await media.put(DRAFT, LOGO, EVENT_LOGO, Uint8Array.of(7, 8, 9))

  invites.seed(
    aGuestInvite({ eventId: LIVE, tokenByte: 1, enabled: true, ...PARTY }),
    aGuestInvite({ eventId: DRAFT, tokenByte: 2, enabled: true, ...PARTY }),
    aGuestInvite({ eventId: CLOSED, tokenByte: 3, enabled: true, ...PARTY }),
    aGuestInvite({ eventId: ARCHIVED, tokenByte: 4, enabled: true, ...PARTY }),
    aGuestInvite({ eventId: 'evt-off', tokenByte: 5, enabled: false, ...PARTY }),
  )

  const harness = buildServerHarness({
    config: {
      rateLimits: {
        uploadPerMinute: 12,
        uploadPerIpPerMinute: 300,
        joinPerMinute: 20,
        guestInvitePerMinute: perMinute,
        loginPerMinute: 10,
        reactionPerMinute: 30,
        reactionPerIpPerMinute: 600,
        guestWritePerMinute: 300,
        galleryPerMinute: 60,
        galleryMediaPerMinute: 600,
        galleryUnlockPerClient: 10,
        galleryUnlockPerLink: 50,
        eventCreationPerHour: 20,
        invitationsPerHour: 30,
        venuePhotosPerHour: 10,
        bookRequestsPerHour: 20,
        logosPerHour: 10,
      },
    },
    usecases: {
      viewGuestInvite: makeViewGuestInvite({ events, invites }),
      getGuestInviteLogoMedia: makeGetGuestInviteLogoMedia({ events, invites, media }),
    },
  })
  void AT
  return { app: harness.app, media, events }
}

const expectGuardHeaders = (response: request.Response): void => {
  expect(response.headers['referrer-policy']).toBe('no-referrer')
  expect(response.headers['x-robots-tag']).toBe('noindex, nofollow')
  expect(response.headers['cache-control']).toBe('no-store')
}

describe('GET /api/i/:token', () => {
  let world: World

  beforeEach(async () => {
    world = await buildWorld()
  })

  it('answers the details of a party that is live, with the way into the wall and the host’s own words', async () => {
    const response = await request(world.app).get(`/api/i/${LIVE_TOKEN}`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      state: 'joinable',
      title: 'Léa fête ses 40 ans',
      when: {
        startsAt: '2026-12-13T18:00:00.000Z',
        endsAt: '2026-12-14T01:00:00.000Z',
        timeZone: 'Europe/Paris',
      },
      venueName: 'Salle des fêtes',
      address: '1 rue de la Gare',
      message: 'Venez comme vous êtes.',
      language: 'de',
      joinUrl: '/join/H7K2QM',
    })
    expectGuardHeaders(response)
  })

  it('has no join url before the party is open: the code does not leave early', async () => {
    const response = await request(world.app).get(`/api/i/${DRAFT_TOKEN}`)

    expect(response.status).toBe(200)
    expect(response.body.state).toBe('upcoming')
    expect('joinUrl' in response.body).toBe(false)
    expect(JSON.stringify(response.body)).not.toContain('B4N9PT')
    expect(response.body.logoUrl).toBe(`/api/i/${DRAFT_TOKEN}/logo`)
  })

  it('leaves the address and the word out of a party that is over, the keys included', async () => {
    const response = await request(world.app).get(`/api/i/${CLOSED_TOKEN}`)

    expect(response.status).toBe(200)
    expect(response.body.state).toBe('over')
    expect('address' in response.body).toBe(false)
    expect('message' in response.body).toBe(false)
    expect('joinUrl' in response.body).toBe(false)
    expect(JSON.stringify(response.body)).not.toContain('rue de la Gare')
  })

  it('starts no session and gives no guest identity: the only cookie is the box-wide CSRF one', async () => {
    const response = await request(world.app).get(`/api/i/${LIVE_TOKEN}`)

    const names = (response.headers['set-cookie'] ?? []).map((cookie) => cookie.split('=')[0])
    expect(names.filter((name) => name !== 'es_csrf')).toEqual([])
  })

  it('reads a token the way a join code is read: case and look-alikes folded', async () => {
    const response = await request(world.app).get(`/api/i/${LIVE_TOKEN}`.toLowerCase())

    expect(response.status).toBe(200)
  })

  it.each([
    ['an unknown token', 'AAAAAAAAAAAAAAAA'],
    ['a token that is too short', 'short'],
    ['a token of the right length with a letter outside the alphabet', 'UUUUUUUUUUUUUUUU'],
    ['a token that is far too long', 'A'.repeat(500)],
    ['a token switched off', OFF_TOKEN],
    ['a token of an archived event', ARCHIVED_TOKEN],
  ])('answers %s with the one 404, the same bytes as every other', async (_name, value) => {
    const unknown = await request(world.app).get('/api/i/AAAAAAAAAAAAAAAA')
    const response = await request(world.app).get(`/api/i/${value}`)

    expect(response.status).toBe(404)
    expect(response.body).toEqual({
      error: { code: 'guestInvite.notAvailable', message: expect.any(String), details: {} },
    })
    expect(response.body).toEqual(unknown.body)
    expectGuardHeaders(response)
  })

  it('answers the one 404 for an event the operator took down', async () => {
    await world.events.setTakenDown(LIVE, new Date('2026-11-21T10:00:00Z'))

    const response = await request(world.app).get(`/api/i/${LIVE_TOKEN}`)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('guestInvite.notAvailable')
  })

  it('has no POST: a guest cannot write anything here', async () => {
    const response = await request(world.app).post(`/api/i/${LIVE_TOKEN}`).send({})

    expect([403, 404, 405]).toContain(response.status)
    expect(response.body.error?.code).not.toBe(undefined)
  })
})

describe('GET /api/i/:token/logo', () => {
  let world: World

  beforeEach(async () => {
    world = await buildWorld()
  })

  it('serves the logo of a draft: the weeks before the party are when the invitation is read', async () => {
    const response = await request(world.app).get(`/api/i/${DRAFT_TOKEN}/logo`).buffer(true)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('image/webp')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(Buffer.from(response.body as Buffer)).toEqual(Buffer.from([7, 8, 9]))
    expectGuardHeaders(response)
  })

  it.each([
    ['an event with no logo', LIVE_TOKEN],
    ['an unknown token', 'AAAAAAAAAAAAAAAA'],
    ['a malformed one', 'x'.repeat(200)],
    ['an archived event', ARCHIVED_TOKEN],
  ])('answers %s with the page’s own 404', async (_name, value) => {
    const response = await request(world.app).get(`/api/i/${value}/logo`)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('guestInvite.notAvailable')
    expectGuardHeaders(response)
  })

  it('stops serving the moment the page does', async () => {
    await world.events.setTakenDown(DRAFT, new Date('2026-11-21T10:00:00Z'))

    const response = await request(world.app).get(`/api/i/${DRAFT_TOKEN}/logo`)

    expect(response.status).toBe(404)
  })

  it('answers a range of the bytes, like every stored object', async () => {
    const response = await request(world.app)
      .get(`/api/i/${DRAFT_TOKEN}/logo`)
      .set('Range', 'bytes=1-2')
      .buffer(true)

    expect(response.status).toBe(206)
    expect(Buffer.from(response.body as Buffer)).toEqual(Buffer.from([8, 9]))
  })
})

describe('the guest invitation limiter', () => {
  it('turns a client away after its budget, with the page and the logo on one bucket', async () => {
    const world = await buildWorld(3)

    const statuses = [
      (await request(world.app).get(`/api/i/${LIVE_TOKEN}`)).status,
      (await request(world.app).get(`/api/i/${DRAFT_TOKEN}/logo`)).status,
      (await request(world.app).get('/api/i/AAAAAAAAAAAAAAAA')).status,
      (await request(world.app).get(`/api/i/${LIVE_TOKEN}`)).status,
    ]

    expect(statuses).toEqual([200, 200, 404, 429])
  })
})
