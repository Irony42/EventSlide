import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { publicRoutes, withPublicEvent } from './publicRoutes'
import { GUEST_COOKIE, resolvePublicEvent } from '../middleware/authz'
import { toWallResponseDto, type PresenterContext } from '../presenters/presenters'
import { sendJson, sendNoContent } from '../presenters/send'
import { buildHarness, type Harness } from '../testing/middlewareHarness'
import type { HttpConfig } from '../types'
import { makeJoinEvent } from '../../../application/usecases/guests/joinEvent'
import {
  makeGetWallPlaylist,
  type WallPlaylistView,
} from '../../../application/usecases/slideshow/getWallPlaylist'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import { aGuest, aPhoto, anEvent, atPlus } from '../../../application/testing/builders'
import type { Photo } from '../../../domain/photos/photo'
import { asEventId } from '../../../domain/shared/ids'
import { CROSSFADE_MS } from '../../../domain/slideshow/kenBurns'
import { buildPlaylist, type Playlist } from '../../../domain/slideshow/playlist'
import { wallLayoutSpec } from '../../../domain/slideshow/wallLayout'

/**
 * The public surface: the front door and the projector.
 *
 * The tests that matter most here are the ones that assert two different failures look
 * identical. `POST /join` has no principal to authorize, so there is no 401 and no 403
 * to write — a stranger with a printed card *is* the happy path. What stands in for the
 * wrong-tenant case is enumeration: an unknown code, a draft, a closed and an archived
 * event must all answer `404 event.notFound`, because a distinguishable "not open yet"
 * tells an attacker which of the codes they guessed are real.
 *
 * Both use cases are the real ones, built over the harness's fakes. A stub would return
 * whatever it was told and every one of those tests would pass while the product leaked.
 */

const WEDDING = 'wedding-id'
const GALA = 'gala-id'
const DRAFT = 'draft-id'
const CLOSED = 'closed-id'
const ARCHIVED = 'archived-id'

const presenter: PresenterContext = {
  publicUrl: 'http://localhost:4300',
  uploadLimits: { maxBytes: 25_000_000, maxFiles: 20 },
}

interface World {
  readonly subject: Harness
  readonly photos: FakePhotoRepository
}

/**
 * One event per lifecycle state, so every enumeration case below is a real row rather
 * than a missing one — the whole point is that the two are indistinguishable.
 */
const world = (config: Partial<HttpConfig> = {}): World => {
  const photos = new FakePhotoRepository()
  const ids = new SequentialIdGenerator()

  const subject = buildHarness({
    config,
    routes: (app, deps) => {
      app.use(
        '/api',
        publicRoutes({
          deps,
          presenter,
          usecases: {
            joinEvent: makeJoinEvent({
              events: deps.events,
              guests: deps.guests,
              tokens: deps.guestTokens,
              ids,
              clock: deps.clock,
              bus: deps.bus,
            }),
            getWallPlaylist: makeGetWallPlaylist({
              events: deps.events,
              photos,
              guests: deps.guests,
            }),
          },
        }),
      )
    },
  })

  subject.events.seed(
    anEvent({
      id: WEDDING,
      slug: 'mariage',
      name: 'Camille & Sacha',
      joinCode: 'H7K2QM',
      status: 'live',
    }),
    anEvent({ id: GALA, slug: 'gala', name: 'Gala Matignon', joinCode: 'B4N9PT', status: 'live' }),
    anEvent({
      id: DRAFT,
      slug: 'brouillon',
      name: 'Pas encore',
      joinCode: 'D3M41N',
      status: 'draft',
    }),
    anEvent({
      id: CLOSED,
      slug: 'termine',
      name: 'Soirée finie',
      joinCode: 'C10SED',
      status: 'closed',
    }),
    anEvent({
      id: ARCHIVED,
      slug: 'archive',
      name: 'Rangé',
      joinCode: 'ARCH1V',
      status: 'archived',
    }),
  )

  return { subject, photos }
}

/** `set-cookie` is an array at runtime and loosely typed; narrow it once, here. */
const setCookies = (header: unknown): readonly string[] =>
  Array.isArray(header) ? header.filter((value): value is string => typeof value === 'string') : []

const guestCookie = (header: unknown): string =>
  setCookies(header).find((value) => value.startsWith(`${GUEST_COOKIE}=`)) ?? ''

const cookieValue = (cookie: string): string =>
  cookie.slice(cookie.indexOf('=') + 1).split(';')[0] ?? ''

// --------------------------------------------------------------- POST /join --

describe('POST /api/join', () => {
  it('lets a stranger holding a printed card in and issues a device cookie', async () => {
    const { subject } = world()

    const response = await request(subject.app)
      .post('/api/join')
      .send({ joinCode: 'H7K2QM', displayName: 'Léa' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      guestId: 'guest-1',
      displayName: 'Léa',
      event: {
        slug: 'mariage',
        name: 'Camille & Sacha',
        allowCaptions: true,
        allowReactions: true,
        maxUploadBytes: 25_000_000,
        maxFilesPerUpload: 20,
      },
    })
  })

  it('scopes the cookie to that one event, HttpOnly and SameSite=Lax', async () => {
    const { subject } = world()

    const response = await request(subject.app).post('/api/join').send({ joinCode: 'H7K2QM' })

    const cookie = guestCookie(response.headers['set-cookie'])
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    // The credential itself, not just a cookie name: verified with the harness's real
    // HMAC service, because forging one is exactly what the token exists to prevent.
    const claims = subject.deps.guestTokens.verify(cookieValue(cookie), subject.clock.now())
    expect(claims.ok && claims.value.eventId).toBe(WEDDING)
    expect(claims.ok && claims.value.guestId).toBe('guest-1')
  })

  it('gives the cookie the same 36 hours the token itself is valid for', async () => {
    // A wedding runs long, and the two lifetimes have to agree: a cookie outliving its
    // token leaves a phone holding a credential the server rejects, with nothing on
    // screen to explain why the upload failed.
    const { subject } = world()

    const response = await request(subject.app).post('/api/join').send({ joinCode: 'H7K2QM' })

    const cookie = guestCookie(response.headers['set-cookie'])
    expect(cookie).toContain('Max-Age=129600')
    const token = cookieValue(cookie)
    const issuedAt = subject.clock.now().getTime()
    expect(subject.deps.guestTokens.verify(token, new Date(issuedAt + 129_600_000)).ok).toBe(true)
    expect(subject.deps.guestTokens.verify(token, new Date(issuedAt + 129_600_001)).ok).toBe(false)
  })

  it.each([
    {
      what: 'a venue LAN on plain HTTP, where Secure would break the join outright',
      secureCookie: false,
    },
    { what: 'a deployment behind TLS', secureCookie: true },
  ])('marks the cookie Secure to match the deployment: $what', async ({ secureCookie }) => {
    const { subject } = world({ secureCookie })

    const response = await request(subject.app).post('/api/join').send({ joinCode: 'H7K2QM' })

    expect(/;\s*Secure/i.test(guestCookie(response.headers['set-cookie']))).toBe(secureCookie)
  })

  it('accepts the code as it was actually typed in a dark room', async () => {
    // Lowercase and a separator: the domain folds case, spacing and the confusable
    // characters, so the printed card and the phone keyboard cannot disagree.
    const { subject } = world()

    const response = await request(subject.app).post('/api/join').send({ joinCode: 'h7k2-qm' })

    expect(response.status).toBe(200)
    expect(response.body.event.slug).toBe('mariage')
  })

  it('treats an absent name as an anonymous guest rather than a validation failure', async () => {
    const { subject } = world()

    const response = await request(subject.app).post('/api/join').send({ joinCode: 'H7K2QM' })

    expect(response.status).toBe(200)
    expect(response.body.displayName).toBeNull()
  })

  it.each([
    { what: 'an unknown code', joinCode: 'ZZZZZZ' },
    { what: 'a draft event nobody may join yet', joinCode: 'D3M41N' },
    { what: 'a closed event', joinCode: 'C10SED' },
    { what: 'an archived event', joinCode: 'ARCH1V' },
  ])('answers an indistinguishable 404 for $what', async ({ joinCode }) => {
    // The enumeration oracle this product must not be: "not open yet" would confirm a
    // guessed code belongs to a real event.
    const { subject } = world()

    const response = await request(subject.app).post('/api/join').send({ joinCode })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
    expect(setCookies(response.headers['set-cookie'])).toEqual([])
  })

  it('answers that same 404 to a device the host revoked, and issues it no cookie', async () => {
    // The re-scan a revocation has to survive: the QR code is printed on every table, so
    // a fresh identity here would put the guest back on the wall within seconds. The
    // answer is the unknown-code one — the guest reading it has just been ejected in
    // front of a room, and the front door is not where that gets explained.
    const { subject } = world()
    subject.guests.seed(aGuest({ id: 'guest-9', eventId: WEDDING, revokedAt: subject.clock.now() }))
    const revokedToken = subject.issueGuestToken(WEDDING, 'guest-9')

    const response = await request(subject.app)
      .post('/api/join')
      .set('Cookie', `${GUEST_COOKIE}=${revokedToken}`)
      .send({ joinCode: 'H7K2QM' })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
    // No fresh credential on the way out, and nothing that names the guest row either.
    expect(setCookies(response.headers['set-cookie'])).toEqual([])
    expect(await subject.guests.list(asEventId(WEDDING))).toHaveLength(1)
  })

  it.each([
    { what: 'no code at all', body: {}, code: 'request.invalid' },
    {
      what: 'a field this contract does not have, which means the client disagrees',
      body: { joinCode: 'H7K2QM', nickname: 'Léa' },
      code: 'request.invalid',
    },
    {
      what: 'a code of the wrong length',
      body: { joinCode: 'H7K2' },
      code: 'joinCode.wrongLength',
    },
    {
      what: 'a code outside the alphabet',
      body: { joinCode: 'H7K2Q!' },
      code: 'joinCode.malformed',
    },
    {
      what: 'a name longer than the wall can show',
      body: { joinCode: 'H7K2QM', displayName: 'é'.repeat(41) },
      code: 'displayName.tooLong',
    },
  ])('answers 400 $code for $what', async ({ body, code }) => {
    const { subject } = world()

    const response = await request(subject.app).post('/api/join').send(body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe(code)
  })

  it('re-issues for the event in the body, never for the event in the presented cookie', async () => {
    // The wrong-tenant case for a route with no principal: a device token for the gala
    // must not be able to influence, or survive, a join to the wedding.
    const { subject } = world()
    const galaToken = subject.issueGuestToken(GALA, 'guest-9')

    const response = await request(subject.app)
      .post('/api/join')
      .set('Cookie', `${GUEST_COOKIE}=${galaToken}`)
      .send({ joinCode: 'H7K2QM' })

    expect(response.status).toBe(200)
    const reissued = cookieValue(guestCookie(response.headers['set-cookie']))
    const claims = subject.deps.guestTokens.verify(reissued, subject.clock.now())
    expect(claims.ok && claims.value.eventId).toBe(WEDDING)
  })

  it('keeps a phone that joins again on the guest its own cookie already names', async () => {
    // The plumbing the use case's idempotence rests on: the handler forwards the cookie
    // the phone presented, unparsed and unauthorized. Without it, a guest who reloads
    // the join page — which re-submits the code on its own — walks away as a second,
    // anonymous guest, and the name they then type lands on a row their photos are not
    // filed under.
    const { subject } = world()
    const first = await request(subject.app).post('/api/join').send({ joinCode: 'H7K2QM' })
    const held = cookieValue(guestCookie(first.headers['set-cookie']))

    const again = await request(subject.app)
      .post('/api/join')
      .set('Cookie', `${GUEST_COOKIE}=${held}`)
      .send({ joinCode: 'H7K2QM', displayName: 'Léa' })

    expect(again.body.guestId).toBe('guest-1')
    expect(again.body.displayName).toBe('Léa')
  })

  it('tells a guest nothing beyond the name and what they may do', async () => {
    const { subject } = world()

    const response = await request(subject.app).post('/api/join').send({ joinCode: 'H7K2QM' })

    expect(Object.keys(response.body.event).sort()).toEqual([
      'allowCaptions',
      'allowReactions',
      'maxFilesPerUpload',
      'maxUploadBytes',
      'name',
      'slug',
    ])
    // Not the join code back, not the quota, not the owner, not a count of anything.
    expect(JSON.stringify(response.body)).not.toContain('H7K2QM')
    expect(JSON.stringify(response.body)).not.toContain(WEDDING)
  })

  it('announces the arrival so the host sees the guest, once the row exists', async () => {
    const { subject } = world()

    await request(subject.app).post('/api/join').send({ joinCode: 'H7K2QM' })

    expect(subject.bus.published).toEqual([
      { type: 'guest.joined', eventId: WEDDING, guestId: 'guest-1' },
    ])
  })

  it('rate-limits the endpoint an attacker would enumerate', async () => {
    const { subject } = world({
      rateLimits: {
        uploadPerMinute: 12,
        joinPerMinute: 1,
        loginPerMinute: 10,
        reactionPerMinute: 30,
      },
    })

    await request(subject.app).post('/api/join').send({ joinCode: 'H7K2QM' }).expect(200)
    const response = await request(subject.app).post('/api/join').send({ joinCode: 'H7K2QM' })

    expect(response.status).toBe(429)
    expect(response.body.error.code).toBe('rate.limited')
  })
})

// ------------------------------------------ GET /events/:eventSlug/wall --

/** Two published photos, one of every status that must never reach the wall. */
const seedWall = (photos: FakePhotoRepository): void => {
  photos.seed(
    aPhoto({
      id: 'photo-1',
      eventId: WEDDING,
      status: 'published',
      createdAt: atPlus(1_000),
      caption: 'Les confettis',
      width: 2560,
      height: 1707,
    }),
    aPhoto({ id: 'photo-2', eventId: WEDDING, status: 'published', createdAt: atPlus(2_000) }),
    aPhoto({ id: 'photo-3', eventId: WEDDING, status: 'pending', createdAt: atPlus(3_000) }),
    aPhoto({ id: 'photo-4', eventId: WEDDING, status: 'rejected', createdAt: atPlus(4_000) }),
    aPhoto({ id: 'photo-5', eventId: WEDDING, status: 'hidden', createdAt: atPlus(5_000) }),
    aPhoto({ id: 'photo-6', eventId: GALA, status: 'published', createdAt: atPlus(6_000) }),
    aPhoto({ id: 'photo-7', eventId: CLOSED, status: 'published', createdAt: atPlus(7_000) }),
  )
}

describe('GET /api/events/:eventSlug/wall', () => {
  it('serves the published photos of a live event, newest first', async () => {
    const { subject, photos } = world()
    seedWall(photos)

    const response = await request(subject.app).get('/api/events/mariage/wall')

    expect(response.status).toBe(200)
    expect(response.body.event).toEqual({ slug: 'mariage', name: 'Camille & Sacha' })
    expect(response.body.items).toEqual([
      {
        id: 'photo-2',
        displayUrl: '/api/events/mariage/photos/photo-2/display',
        thumbUrl: '/api/events/mariage/photos/photo-2/thumb',
        width: 4032,
        height: 3024,
        caption: null,
        authorName: null,
        createdAt: atPlus(2_000).toISOString(),
      },
      {
        id: 'photo-1',
        displayUrl: '/api/events/mariage/photos/photo-1/display',
        thumbUrl: '/api/events/mariage/photos/photo-1/thumb',
        width: 2560,
        height: 1707,
        caption: 'Les confettis',
        authorName: null,
        createdAt: atPlus(1_000).toISOString(),
      },
    ])
  })

  it('presents the timings the domain derived, not two independent settings', async () => {
    // The Ken Burns duration is the slide interval plus the crossfade. 1.0 shipped a 20s
    // zoom against a 10s slide and every image snapped back to its start scale.
    const { subject, photos } = world()
    seedWall(photos)

    const response = await request(subject.app).get('/api/events/mariage/wall')

    expect(response.body.slideIntervalMs).toBe(8_000)
    expect(response.body.kenBurnsDurationMs).toBe(8_800)
    // The relationship, not just the pair of numbers: this is what fails the moment the
    // route computes either side of it instead of presenting what the domain derived.
    expect(response.body.kenBurnsDurationMs).toBe(response.body.slideIntervalMs + CROSSFADE_MS)
    expect(response.body.layout).toBe('spotlight')
    expect(response.body.reactionsEnabled).toBe(true)
    expect(response.body.revision).toEqual(expect.any(String))
  })

  it('is structurally incapable of showing a photo the host has not published', async () => {
    // Not "filters them out" — the read model is `['published']`, a module constant in
    // the use case that no caller can widen. Pending, rejected and hidden photos exist
    // in this event and the wall is still empty.
    const { subject, photos } = world()
    photos.seed(
      aPhoto({ id: 'photo-3', eventId: WEDDING, status: 'pending' }),
      aPhoto({ id: 'photo-4', eventId: WEDDING, status: 'rejected' }),
      aPhoto({ id: 'photo-5', eventId: WEDDING, status: 'hidden' }),
    )

    const response = await request(subject.app).get('/api/events/mariage/wall')

    expect(response.status).toBe(200)
    expect(response.body.items).toEqual([])
  })

  it('never shows a published photo belonging to another event', async () => {
    const { subject, photos } = world()
    seedWall(photos)

    const response = await request(subject.app).get('/api/events/mariage/wall')

    // Asserted by exhaustion rather than by absence alone: a `not.toContain` also passes
    // on an empty wall, which would hide a read that returned nothing at all.
    expect(response.body.items).toEqual([
      expect.objectContaining({ id: 'photo-2' }),
      expect.objectContaining({ id: 'photo-1' }),
    ])
    expect(response.body.items).not.toContainEqual(expect.objectContaining({ id: 'photo-6' }))
  })

  it('credits the guest who sent each photo, which is what the upload page promised', async () => {
    // docs/API.md line 171 declares `"authorName": "Léa"` here, the upload page tells the
    // guest their photos appear under the name they gave, and the slide has a line for
    // it. The name is resolved by the use case — the controller performs no second read.
    const { subject, photos } = world()
    subject.guests.seed(
      aGuest({ id: 'guest-lea', eventId: WEDDING, displayName: 'Léa' }),
      aGuest({ id: 'guest-sacha', eventId: WEDDING, displayName: 'Sacha' }),
    )
    photos.seed(
      aPhoto({
        id: 'photo-1',
        eventId: WEDDING,
        status: 'published',
        createdAt: atPlus(1_000),
        caption: 'Les confettis',
        author: { kind: 'guest', id: 'guest-lea' },
      }),
      aPhoto({
        id: 'photo-2',
        eventId: WEDDING,
        status: 'published',
        createdAt: atPlus(2_000),
        author: { kind: 'guest', id: 'guest-sacha' },
      }),
    )

    const response = await request(subject.app).get('/api/events/mariage/wall')

    expect(response.body.items).toEqual([
      expect.objectContaining({ id: 'photo-2', authorName: 'Sacha' }),
      expect.objectContaining({ id: 'photo-1', caption: 'Les confettis', authorName: 'Léa' }),
    ])
  })

  it('sends an accented name across the wire exactly as it was typed', async () => {
    const { subject, photos } = world()
    subject.guests.seed(aGuest({ id: 'guest-zoe', eventId: WEDDING, displayName: 'Zoé Müller' }))
    photos.seed(
      aPhoto({
        id: 'photo-1',
        eventId: WEDDING,
        status: 'published',
        author: { kind: 'guest', id: 'guest-zoe' },
      }),
    )

    const response = await request(subject.app).get('/api/events/mariage/wall')

    expect(response.body.items[0].authorName).toBe('Zoé Müller')
  })

  it('sends null for an anonymous guest, so the wall shows no credit at all', async () => {
    // Not "Invité": the fallback is French UI copy and lives in web/src/lib/i18n/, and a
    // guest who declined to give a name has not asked to be labelled in front of a room.
    const { subject, photos } = world()
    subject.guests.seed(aGuest({ id: 'guest-timide', eventId: WEDDING, displayName: null }))
    photos.seed(
      aPhoto({
        id: 'photo-1',
        eventId: WEDDING,
        status: 'published',
        author: { kind: 'guest', id: 'guest-timide' },
      }),
    )

    const response = await request(subject.app).get('/api/events/mariage/wall')

    expect(response.body.items).toEqual([expect.objectContaining({ id: 'photo-1' })])
    expect(response.body.items[0].authorName).toBeNull()
  })

  it('never puts another event guest name on this wall', async () => {
    // The wall is public and unauthenticated. A name lookup that was not event-scoped
    // would read one party's guest list onto another party's projector.
    const { subject, photos } = world()
    subject.guests.seed(aGuest({ id: 'guest-sam', eventId: GALA, displayName: 'Sam' }))
    photos.seed(
      aPhoto({
        id: 'photo-1',
        eventId: WEDDING,
        status: 'published',
        author: { kind: 'guest', id: 'guest-sam' },
      }),
    )

    const response = await request(subject.app).get('/api/events/mariage/wall')

    expect(response.body.items[0].authorName).toBeNull()
  })

  it('carries the name and nothing else about the guest who sent it', async () => {
    // A projector stands in a room of strangers. The first name is what the guest typed
    // for exactly this purpose; their id, their presence and their photo count are not.
    const { subject, photos } = world()
    subject.guests.seed(aGuest({ id: 'guest-lea', eventId: WEDDING, displayName: 'Léa' }))
    photos.seed(
      aPhoto({
        id: 'photo-1',
        eventId: WEDDING,
        status: 'published',
        author: { kind: 'guest', id: 'guest-lea' },
      }),
    )

    const response = await request(subject.app).get('/api/events/mariage/wall')

    expect(Object.keys(response.body.items[0]).sort()).toEqual([
      'authorName',
      'caption',
      'createdAt',
      'displayUrl',
      'height',
      'id',
      'thumbUrl',
      'width',
    ])
  })

  it('still serves a closed event, because the projector is usually still on', async () => {
    const { subject, photos } = world()
    seedWall(photos)

    const response = await request(subject.app).get('/api/events/termine/wall')

    expect(response.status).toBe(200)
    expect(response.body.items).toEqual([expect.objectContaining({ id: 'photo-7' })])
  })

  it.each([
    { what: 'a draft event, which no room may see yet', slug: 'brouillon' },
    { what: 'an archived event, which is out of the dashboard', slug: 'archive' },
    { what: 'a slug that exists nowhere', slug: 'pas-de-fete' },
    { what: 'a slug that is not even slug-shaped', slug: 'Mariage' },
  ])('answers an indistinguishable 404 for $what', async ({ slug }) => {
    const { subject, photos } = world()
    seedWall(photos)

    const response = await request(subject.app).get(`/api/events/${slug}/wall`)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })

  it('changes the revision when the playlist changes, and only then', async () => {
    // The projector compares revisions on every SSE signal to decide whether to redraw.
    // A revision that moved on an unrelated event is 1.0's wall jumping all evening.
    const { subject, photos } = world()
    seedWall(photos)

    const before = await request(subject.app).get('/api/events/mariage/wall')
    const unchanged = await request(subject.app).get('/api/events/mariage/wall')
    photos.seed(
      aPhoto({ id: 'photo-8', eventId: WEDDING, status: 'published', createdAt: atPlus(8_000) }),
    )
    const after = await request(subject.app).get('/api/events/mariage/wall')

    expect(unchanged.body.revision).toBe(before.body.revision)
    expect(after.body.revision).not.toBe(before.body.revision)
  })

  it('sends Cache-Control: no-store, because a cached playlist is a wall that stopped', async () => {
    const { subject, photos } = world()
    seedWall(photos)

    const response = await request(subject.app).get('/api/events/mariage/wall')

    expect(response.headers['cache-control']).toBe('no-store')
  })

  // Both flag states, because a config flag must not be what protects the room: the two
  // timings are one derived pair, and a query parameter that set either half would put
  // back 1.0's zoom snapping mid-slide. The projector's own test hooks are applied in the
  // browser (`useTimingOverrides`), so a Playwright run needs nothing from this response.
  it.each([
    { what: 'the server was never started with E2E_HOOKS', e2eHooks: false },
    { what: 'the server was started with E2E_HOOKS', e2eHooks: true },
  ])('lets no query string dictate the room timing, even when $what', async ({ e2eHooks }) => {
    const { subject, photos } = world({ e2eHooks })
    seedWall(photos)

    const response = await request(subject.app).get(
      '/api/events/mariage/wall?e2e_interval=250&e2e_transition=10000',
    )

    expect(response.status).toBe(200)
    expect(response.body.slideIntervalMs).toBe(8_000)
    expect(response.body.kenBurnsDurationMs).toBe(8_800)
  })

  // A layout is refused like any other parameter this contract does not have, valid
  // name or not: the layout a room sees belongs to the screen showing it. The display
  // URL's `?layout=` is read in the browser (`useLayoutParam`) and the host's `L` key
  // changes the same thing, so a layout reaching the API could only be the server
  // holding one client's view state for the length of a request.
  it.each([
    { what: 'a layout this build renders', query: 'layout=mosaic' },
    { what: 'a layout that does not exist', query: 'layout=neon' },
    { what: 'a timing value outside the parsed bounds', query: 'e2e_interval=1' },
    { what: 'a parameter this contract does not have', query: 'windowSize=9000' },
  ])('answers 400 request.invalid for $what', async ({ query }) => {
    const { subject, photos } = world({ e2eHooks: true })
    seedWall(photos)

    const response = await request(subject.app).get(`/api/events/mariage/wall?${query}`)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })
})

// -------------------------------------------------------- withPublicEvent --

/**
 * The narrowing the wall handler relies on.
 *
 * Unreachable behind `resolvePublicEvent`, which is the point: if the authorization
 * middleware is ever dropped from a public route, the route must fail closed with the
 * same 404 every other absent event gets, rather than dereference nothing and answer
 * 500 after the fact.
 */
describe('withPublicEvent', () => {
  const guarded = (): Harness =>
    buildHarness({
      routes: (app, deps) => {
        app.get(
          '/bare',
          withPublicEvent(async (_event, _req, res) => {
            sendNoContent(res)
          }),
        )
        // The event the middleware resolved, echoed back so the test can assert the
        // handler was handed that event and not merely reached.
        app.get(
          '/events/:eventSlug/resolved',
          resolvePublicEvent(deps),
          withPublicEvent(async (event, _req, res) => {
            sendJson(res, { slug: event.slug.value })
          }),
        )
      },
    })

  it('answers 404 when no authorization middleware ran at all', async () => {
    const response = await request(guarded().app).get('/bare')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })

  it('hands the resolved event to the handler', async () => {
    const subject = guarded()
    subject.events.seed(anEvent({ id: WEDDING, slug: 'mariage', status: 'live' }))

    const response = await request(subject.app).get('/events/mariage/resolved')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ slug: 'mariage' })
  })
})

// -------------------------------------------------------------- presenter --

/** A fixture that throws rather than a `Result` to narrow: a bad fixture is a bad test. */
const playlistOf = (photos: readonly Photo[]): Playlist => {
  const built = buildPlaylist(
    photos.map((photo) => ({ id: photo.id, createdAt: photo.createdAt })),
    { windowSize: 200, freshFirst: true },
  )
  if (!built.ok) throw new Error(`fixture rejected by the domain (${built.error.code})`)
  return built.value
}

describe('toWallResponseDto', () => {
  it('drops a playlist entry with no photo behind it rather than emitting a hole', () => {
    // Unreachable through the use case, which builds both from one read — but the
    // projector renders whatever this array holds, and one slide short beats a slide
    // with no image and no dimensions.
    const shown = aPhoto({ id: 'photo-1', status: 'published', createdAt: atPlus(1_000) })
    const vanished = aPhoto({ id: 'photo-2', status: 'published', createdAt: atPlus(2_000) })
    const view: WallPlaylistView = {
      event: anEvent({ slug: 'mariage' }),
      playlist: playlistOf([shown, vanished]),
      photos: [shown],
      authorNames: new Map(),
      slideIntervalMs: 8_000,
      kenBurnsDurationMs: 8_800,
      layout: 'spotlight',
      layoutSpec: wallLayoutSpec('spotlight'),
    }

    const dto = toWallResponseDto(view)

    expect(dto.items.map((item) => item.id)).toEqual(['photo-1'])
  })
})
