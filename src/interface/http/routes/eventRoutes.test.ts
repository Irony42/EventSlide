import type { Express } from 'express'
import request, { type Agent, type Test } from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Logger } from '../../../application/ports/logger'
import type { MediaMetadata, MediaStore } from '../../../application/ports/mediaStore'
import type { PasswordHasher } from '../../../application/ports/passwordHasher'
import { makeRegisterModerator } from '../../../application/usecases/auth/registerModerator'
import { makeChangeEventStatus } from '../../../application/usecases/events/changeEventStatus'
import { makeCreateEvent } from '../../../application/usecases/events/createEvent'
import { makeGetEventBySlug } from '../../../application/usecases/events/getEventBySlug'
import { makeListEventsForHost } from '../../../application/usecases/events/listEventsForHost'
import { makePurgeEvent } from '../../../application/usecases/events/purgeEvent'
import { makeRotateJoinCode } from '../../../application/usecases/events/rotateJoinCode'
import { makeScheduleEvent } from '../../../application/usecases/events/scheduleEvent'
import { makeUpdateEventSettings } from '../../../application/usecases/events/updateEventSettings'
import { makeListGuests } from '../../../application/usecases/guests/listGuests'
import { makeRevokeGuest } from '../../../application/usecases/guests/revokeGuest'
import { AT, anEvent, aGuest, aPhoto, aUser, atPlus } from '../../../application/testing/builders'
import { FakeEventRepository } from '../../../application/testing/fakeEventRepository'
import { FakeGuestRepository } from '../../../application/testing/fakeGuestRepository'
import { FakeMembershipRepository } from '../../../application/testing/fakeMembershipRepository'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { FakeUserRepository } from '../../../application/testing/fakeUserRepository'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import { asEventId, asGuestId, asUserId, type EventId } from '../../../domain/shared/ids'
import type { Password } from '../../../domain/users/password'
import type { PasswordHash } from '../../../domain/users/user'
import { buildHarness, signInAs } from '../testing/middlewareHarness'
import type { HttpDeps, RequestContext } from '../types'
import type { HttpUseCases } from '../useCases'
import { currentUser, eventRoutes, hostScope } from './eventRoutes'

/**
 * The host's surface, driven through a real Express app.
 *
 * Two events with different owners are seeded in every test, because the case that
 * catches real incidents is not the happy path: it is the gala's owner reaching for the
 * wedding, which must answer **404** rather than 403 — a 403 confirms the event exists
 * and turns this surface into an enumeration oracle for other people's weddings.
 */

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

/** UUIDs, because `moderatorParams` and `guestParams` parse them as such. */
const OWNER = '11111111-1111-4111-8111-111111111111'
const MODERATOR = '22222222-2222-4222-8222-222222222222'
const GALA_OWNER = '33333333-3333-4333-8333-333333333333'
const NEWCOMER = '44444444-4444-4444-8444-444444444444'
const WEDDING_GUEST = '55555555-5555-4555-8555-555555555555'
const AWAY_GUEST = '66666666-6666-4666-8666-666666666666'
const REVOKED_GUEST = '77777777-7777-4777-8777-777777777777'
const GALA_GUEST = '88888888-8888-4888-8888-888888888888'

const SLUG = 'camille-et-sacha'
const NO_SUCH_SLUG = 'un-evenement-qui-nexiste-pas'

/** What the create form leaves to configuration: the host is asked for a name only. */
const DEFAULT_QUOTA_BYTES = 2_000_000_000

/** What the host types into the invitation form and reads out to the invitee. */
const TEMPORARY_PASSWORD = 'mot-de-passe-provisoire'

/**
 * Two instants ahead of the harness clock ({@link AT}, 21:00), already resolved by the
 * browser. Ahead of it on purpose: the domain refuses a schedule that has already gone
 * by, so a fixture in the past would exercise that refusal rather than the happy path.
 */
const SCHEDULED_OPEN_AT = '2026-06-20T22:00:00.000Z'
const SCHEDULED_CLOSE_AT = '2026-06-21T04:00:00.000Z'
/** Before the harness clock: what the host sends when they forget to advance the date. */
const ALREADY_PAST = '2026-06-20T02:00:00.000Z'

const notPartOfTheseRoutes = (method: string): never => {
  throw new Error(`MediaStore.${method} is not part of the host's event routes`)
}

/**
 * Only `deleteEvent` belongs to this surface — a purge. The rest of the port throws, so
 * a handler that quietly started reading bytes would fail loudly rather than pass
 * against a permissive stub.
 */
class PurgingMediaStore implements MediaStore {
  readonly purged: EventId[] = []

  async deleteEvent(eventId: EventId): Promise<void> {
    this.purged.push(eventId)
  }

  put = async (): Promise<void> => notPartOfTheseRoutes('put')
  exists = async (): Promise<boolean> => notPartOfTheseRoutes('exists')
  stat = async (): Promise<MediaMetadata | null> => notPartOfTheseRoutes('stat')
  openRead = async (): Promise<AsyncIterable<Uint8Array> | null> => notPartOfTheseRoutes('openRead')
  read = async (): Promise<Uint8Array | null> => notPartOfTheseRoutes('read')
  delete = async (): Promise<void> => notPartOfTheseRoutes('delete')
  usedBytes = async (): Promise<number> => notPartOfTheseRoutes('usedBytes')
}

/**
 * `src/application/testing/` has no password hasher fake yet, so this one is local to
 * the file that needs it: the invitation route is the only host route that hashes.
 */
class FakePasswordHasher implements PasswordHasher {
  readonly dummyHash: PasswordHash = 'hash:mot-de-passe-factice'

  async hash(password: Password): Promise<PasswordHash> {
    return `hash:${password.value}`
  }

  async verify(attempt: string, hash: PasswordHash): Promise<boolean> {
    return hash === `hash:${attempt}`
  }

  needsRehash(): boolean {
    return false
  }
}

/**
 * A stand-in for the use cases this module never calls.
 *
 * `RouteDeps` asks for the whole application surface, and listing the absent ones
 * explicitly is what makes "which use cases does the host's surface actually reach"
 * readable. Each rejects rather than resolving, so a handler that started reaching for
 * one would fail loudly instead of passing against a permissive double.
 */
const absent = (name: string) => (): Promise<never> =>
  Promise.reject(new Error(`${name} is not part of the host's event routes`))

interface World {
  readonly app: Express
  readonly events: FakeEventRepository
  readonly guests: FakeGuestRepository
  readonly memberships: FakeMembershipRepository
  readonly users: FakeUserRepository
  readonly media: PurgingMediaStore
}

const buildWorld = (): World => {
  const users = new FakeUserRepository()
  const photos = new FakePhotoRepository()
  const guests = new FakeGuestRepository()
  const memberships = new FakeMembershipRepository({ users })
  // Linked, so a dashboard row carries the counts the SQLite join would really produce
  // and a membership carries the address of a real account.
  const events = new FakeEventRepository({ memberships, photos, guests })
  const media = new PurgingMediaStore()
  const ids = new SequentialIdGenerator()
  const hasher = new FakePasswordHasher()

  const harness = buildHarness({
    routes: (app, harnessDeps) => {
      // The harness builds unlinked repositories of its own; the router gets the linked
      // ones instead, and shares everything else — the same clock, the same recording
      // bus, the same config.
      const deps: HttpDeps = { ...harnessDeps, events, guests, memberships }

      const usecases: HttpUseCases = {
        authenticateUser: absent('authenticateUser'),
        changePassword: absent('changePassword'),
        registerModerator: makeRegisterModerator({
          events,
          users,
          memberships,
          hasher,
          ids,
          clock: deps.clock,
        }),

        createEvent: makeCreateEvent({
          events,
          memberships,
          ids,
          clock: deps.clock,
          defaultQuotaBytes: DEFAULT_QUOTA_BYTES,
        }),
        getEventBySlug: makeGetEventBySlug({ events }),
        listEventsForHost: makeListEventsForHost({ events }),
        resolveJoinCode: absent('resolveJoinCode'),
        updateEventSettings: makeUpdateEventSettings({ events, memberships, bus: deps.bus }),
        rotateJoinCode: makeRotateJoinCode({ events, memberships, ids, bus: deps.bus }),
        changeEventStatus: makeChangeEventStatus({
          events,
          memberships,
          bus: deps.bus,
          clock: deps.clock,
        }),
        scheduleEvent: makeScheduleEvent({
          events,
          memberships,
          bus: deps.bus,
          clock: deps.clock,
        }),
        purgeEvent: makePurgeEvent({ events, memberships, media }),

        joinEvent: absent('joinEvent'),
        authenticateGuest: absent('authenticateGuest'),
        renameGuest: absent('renameGuest'),
        revokeGuest: makeRevokeGuest({ guests, memberships, clock: deps.clock }),
        listGuests: makeListGuests({ guests, memberships, clock: deps.clock }),

        uploadPhotos: absent('uploadPhotos'),
        listEventPhotos: absent('listEventPhotos'),
        listGuestPhotos: absent('listGuestPhotos'),
        deletePhoto: absent('deletePhoto'),
        setPhotoCaption: absent('setPhotoCaption'),
        getPhotoMedia: absent('getPhotoMedia'),
        exportAlbum: absent('exportAlbum'),

        getModerationQueue: absent('getModerationQueue'),
        moderatePhoto: absent('moderatePhoto'),
        moderatePhotosBulk: absent('moderatePhotosBulk'),

        getWallPlaylist: absent('getWallPlaylist'),

        reactToPhoto: absent('reactToPhoto'),
        withdrawReaction: absent('withdrawReaction'),
        getPhotoReactions: absent('getPhotoReactions'),
        getTopPhotos: absent('getTopPhotos'),
      }

      app.post('/sign-in/owner', signInAs({ userId: OWNER, email: 'hote@example.test' }))
      app.post(
        '/sign-in/moderator',
        signInAs({ userId: MODERATOR, email: 'moderateur@example.test' }),
      )
      app.post('/sign-in/gala-owner', signInAs({ userId: GALA_OWNER, email: 'gala@example.test' }))
      app.post('/sign-in/newcomer', signInAs({ userId: NEWCOMER, email: 'nouvelle@example.test' }))

      app.use(
        '/api',
        eventRoutes({
          deps,
          usecases,
          presenter: { publicUrl: deps.config.publicUrl, uploadLimits: deps.config.uploads },
        }),
      )
    },
  })

  users.seed(
    aUser({ id: OWNER, email: 'hote@example.test', displayName: 'Camille' }),
    aUser({ id: MODERATOR, email: 'moderateur@example.test' }),
    aUser({ id: GALA_OWNER, email: 'gala@example.test' }),
    aUser({ id: NEWCOMER, email: 'nouvelle@example.test' }),
  )

  events.seed(
    anEvent({
      id: WEDDING,
      ownerId: OWNER,
      slug: SLUG,
      name: 'Camille & Sacha',
      joinCode: 'H7K2QM',
      // `draft`, so the lifecycle route has a legal transition to make (`live`) and an
      // illegal one to refuse (`closed`).
      status: 'draft',
      quotaBytes: 5_000_000_000,
      settings: { retentionDays: 30, maxPhotosPerGuest: 20 },
    }),
    anEvent({
      id: GALA,
      ownerId: GALA_OWNER,
      slug: 'gala-annuel',
      name: 'Gala annuel',
      joinCode: 'Z3N9PT',
    }),
  )

  memberships.seed(
    { eventId: WEDDING, userId: asUserId(OWNER), role: 'owner', grantedAt: AT },
    { eventId: WEDDING, userId: asUserId(MODERATOR), role: 'moderator', grantedAt: atPlus(1_000) },
    { eventId: GALA, userId: asUserId(GALA_OWNER), role: 'owner', grantedAt: AT },
  )

  photos.seed(
    aPhoto({ id: 'photo-1', eventId: WEDDING, status: 'published', byteSize: 2_000_000 }),
    aPhoto({ id: 'photo-2', eventId: WEDDING, status: 'pending', byteSize: 1_000_000 }),
    // The gala's photo must never reach a wedding count.
    aPhoto({ id: 'photo-3', eventId: GALA, status: 'published', byteSize: 9_000_000 }),
  )

  guests.seed(
    aGuest({ id: WEDDING_GUEST, eventId: WEDDING, displayName: 'Léa', lastSeenAt: AT }),
    aGuest({
      id: AWAY_GUEST,
      eventId: WEDDING,
      displayName: null,
      lastSeenAt: atPlus(-30 * 60 * 1_000),
    }),
    aGuest({ id: REVOKED_GUEST, eventId: WEDDING, lastSeenAt: AT, revokedAt: AT }),
    aGuest({ id: GALA_GUEST, eventId: GALA, displayName: 'Sacha', lastSeenAt: AT }),
  )

  return { app: harness.app, events, guests, memberships, users, media }
}

type Who = 'owner' | 'moderator' | 'gala-owner' | 'newcomer'

/** A supertest agent holding a session cookie, without driving a real login. */
const signedIn = async (world: World, who: Who): Promise<Agent> => {
  const agent = request.agent(world.app)
  await agent.post(`/sign-in/${who}`).expect(204)
  return agent
}

interface RouteCase {
  readonly name: string
  /** `user` for the two routes that are not event-scoped. */
  readonly requires: 'user' | 'moderator' | 'owner'
  readonly call: (client: Agent, slug: string) => Test
}

/**
 * Every route on this surface, so the authorization cases below are exhaustive by
 * construction rather than by whoever remembered to add one.
 */
const ROUTES: readonly RouteCase[] = [
  {
    name: 'GET /events',
    requires: 'user',
    call: (client) => client.get('/api/events'),
  },
  {
    name: 'POST /events',
    requires: 'user',
    call: (client) => client.post('/api/events').send({ name: 'Un mariage en juin' }),
  },
  {
    name: 'GET /events/:slug',
    requires: 'moderator',
    call: (client, slug) => client.get(`/api/events/${slug}`),
  },
  {
    name: 'PATCH /events/:slug',
    requires: 'owner',
    call: (client, slug) => client.patch(`/api/events/${slug}`).send({ name: 'Un autre nom' }),
  },
  {
    name: 'PATCH /events/:slug/settings',
    requires: 'owner',
    call: (client, slug) =>
      client.patch(`/api/events/${slug}/settings`).send({ moderation: 'auto' }),
  },
  {
    name: 'POST /events/:slug/status',
    requires: 'owner',
    call: (client, slug) => client.post(`/api/events/${slug}/status`).send({ status: 'live' }),
  },
  {
    name: 'PATCH /events/:slug/schedule',
    requires: 'owner',
    call: (client, slug) =>
      client
        .patch(`/api/events/${slug}/schedule`)
        .send({ scheduledOpenAt: SCHEDULED_OPEN_AT, scheduledCloseAt: SCHEDULED_CLOSE_AT }),
  },
  {
    name: 'POST /events/:slug/join-code',
    requires: 'owner',
    call: (client, slug) => client.post(`/api/events/${slug}/join-code`),
  },
  {
    name: 'DELETE /events/:slug',
    requires: 'owner',
    call: (client, slug) => client.delete(`/api/events/${slug}`),
  },
  {
    name: 'GET /events/:slug/guests',
    requires: 'moderator',
    call: (client, slug) => client.get(`/api/events/${slug}/guests`),
  },
  {
    name: 'POST /events/:slug/guests/:guestId/revoke',
    requires: 'moderator',
    call: (client, slug) => client.post(`/api/events/${slug}/guests/${WEDDING_GUEST}/revoke`),
  },
  {
    name: 'GET /events/:slug/moderators',
    requires: 'owner',
    call: (client, slug) => client.get(`/api/events/${slug}/moderators`),
  },
  {
    name: 'POST /events/:slug/moderators',
    requires: 'owner',
    call: (client, slug) =>
      client
        .post(`/api/events/${slug}/moderators`)
        .send({ email: 'lea@example.test', temporaryPassword: TEMPORARY_PASSWORD }),
  },
  {
    name: 'DELETE /events/:slug/moderators/:userId',
    requires: 'owner',
    call: (client, slug) => client.delete(`/api/events/${slug}/moderators/${MODERATOR}`),
  },
]

const eventScoped = ROUTES.filter((route) => route.requires !== 'user')
const ownerOnly = ROUTES.filter((route) => route.requires === 'owner')

interface InputCase {
  readonly name: string
  readonly call: (client: Agent) => Test
}

/** One rejected input per route that reads a body, a query or an id out of the path. */
const INVALID_INPUTS: readonly InputCase[] = [
  {
    name: 'POST /events without a name',
    call: (client) => client.post('/api/events').send({ slug: 'un-mariage' }),
  },
  {
    name: 'POST /events with an unexpected key',
    call: (client) => client.post('/api/events').send({ name: 'Un mariage', ownerId: OWNER }),
  },
  {
    name: 'PATCH /events/:slug with an empty name',
    call: (client) => client.patch(`/api/events/${SLUG}`).send({ name: '' }),
  },
  {
    name: 'PATCH /events/:slug/settings with a moderation mode outside the enum',
    call: (client) => client.patch(`/api/events/${SLUG}/settings`).send({ moderation: 'parfois' }),
  },
  {
    name: 'PATCH /events/:slug/settings with a retention out of range',
    call: (client) => client.patch(`/api/events/${SLUG}/settings`).send({ retentionDays: 0 }),
  },
  {
    name: 'POST /events/:slug/status with a status outside the enum',
    call: (client) => client.post(`/api/events/${SLUG}/status`).send({ status: 'annule' }),
  },
  {
    // A wall-clock time with no offset. The server has no idea what time it is at the
    // venue, so a string it would have to guess at is refused rather than interpreted.
    name: 'PATCH /events/:slug/schedule with a time carrying no timezone',
    call: (client) =>
      client
        .patch(`/api/events/${SLUG}/schedule`)
        .send({ scheduledOpenAt: '2026-06-20T18:00:00', scheduledCloseAt: null }),
  },
  {
    name: 'PATCH /events/:slug/schedule with only half the schedule',
    call: (client) =>
      client.patch(`/api/events/${SLUG}/schedule`).send({ scheduledOpenAt: SCHEDULED_OPEN_AT }),
  },
  {
    name: 'GET /events/:slug/guests with an unexpected query parameter',
    call: (client) => client.get(`/api/events/${SLUG}/guests?activeWithin=30`),
  },
  {
    // The parameter this endpoint used to accept and discard. It is refused now, which
    // is the whole point: a host asking for a two-hour window is told it is not a
    // question this endpoint answers, instead of receiving five minutes and believing
    // they asked for two hours.
    name: 'GET /events/:slug/guests with the activeWithinMinutes it used to ignore',
    call: (client) => client.get(`/api/events/${SLUG}/guests?activeWithinMinutes=120`),
  },
  {
    name: 'POST /events/:slug/guests/:guestId/revoke with a guest id that is not a UUID',
    call: (client) => client.post(`/api/events/${SLUG}/guests/guest-1/revoke`),
  },
  {
    name: 'POST /events/:slug/moderators without the temporary password',
    call: (client) =>
      client.post(`/api/events/${SLUG}/moderators`).send({ email: 'lea@example.test' }),
  },
  {
    name: 'DELETE /events/:slug/moderators/:userId with a user id that is not a UUID',
    call: (client) => client.delete(`/api/events/${SLUG}/moderators/user-2`),
  },
]

describe('the host event routes', () => {
  let world: World

  beforeEach(() => {
    world = buildWorld()
  })

  describe('authorization', () => {
    it.each(ROUTES)('answers 401 without a session: $name', async ({ call }) => {
      const response = await call(request(world.app), SLUG)

      expect(response.status).toBe(401)
      expect(response.body.error.code).toBe('auth.required')
    })

    it.each(eventScoped)(
      'answers 404, never 403, for a host with no part in the event: $name',
      async ({ call }) => {
        // The gala's owner is a real principal with no membership here. A 403 would
        // confirm that this wedding exists.
        const response = await call(await signedIn(world, 'gala-owner'), SLUG)

        expect(response.status).toBe(404)
        expect(response.body.error.code).toBe('event.notFound')
      },
    )

    it.each(ownerOnly)('answers 403 for a moderator of this event: $name', async ({ call }) => {
      // In scope, so 403 is honest here and reveals nothing they did not already know.
      const response = await call(await signedIn(world, 'moderator'), SLUG)

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('auth.forbidden')
    })

    it.each(eventScoped)('answers 404 for a slug that names no event: $name', async ({ call }) => {
      const response = await call(await signedIn(world, 'owner'), NO_SUCH_SLUG)

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('event.notFound')
    })

    it.each(INVALID_INPUTS)('answers 400 request.invalid: $name', async ({ call }) => {
      const response = await call(await signedIn(world, 'owner'))

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('request.invalid')
    })
  })

  describe('GET /api/events', () => {
    it("lists the caller's events with the counts the dashboard shows", async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.get('/api/events')

      expect(response.status).toBe(200)
      expect(response.body.items).toEqual([
        {
          id: WEDDING,
          slug: SLUG,
          name: 'Camille & Sacha',
          status: 'draft',
          photoCount: 2,
          pendingCount: 1,
          guestCount: 3,
          usedBytes: 3_000_000,
          createdAt: AT.toISOString(),
        },
      ])
    })

    it("never lists another host's event", async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.get('/api/events')

      expect(response.body.items.map((item: { slug: string }) => item.slug)).not.toContain(
        'gala-annuel',
      )
    })

    it('answers 200 with an empty list for a host with no events', async () => {
      // A 404 here would make "no events yet" look like a broken page on a first login.
      const agent = await signedIn(world, 'newcomer')

      const response = await agent.get('/api/events')

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ items: [] })
    })

    it('includes an event the caller only moderates', async () => {
      const agent = await signedIn(world, 'moderator')

      const response = await agent.get('/api/events')

      expect(response.body.items.map((item: { slug: string }) => item.slug)).toEqual([SLUG])
    })
  })

  describe('POST /api/events', () => {
    it('derives the slug from the name and answers 201 with the join code', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.post('/api/events').send({ name: 'Un mariage en juin' })

      expect(response.status).toBe(201)
      expect(response.body).toMatchObject({
        slug: 'un-mariage-en-juin',
        name: 'Un mariage en juin',
        status: 'draft',
        // A brand-new event: no photos, no guests, nothing used.
        photoCount: 0,
        pendingCount: 0,
        guestCount: 0,
        usedBytes: 0,
      })
      expect(response.body.joinCode).toMatch(/^[0-9A-Z]{6}$/)
    })

    it('answers with the link behind the QR code, from the configured public URL', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.post('/api/events').send({ name: 'Un mariage en juin' })

      expect(response.body.joinUrl).toBe(
        `http://localhost:4300/join/${String(response.body.joinCode)}`,
      )
    })

    it('makes the creator the owner', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.post('/api/events').send({ name: 'Un mariage en juin' })

      expect(response.body.role).toBe('owner')
    })

    it('honours an explicit slug', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .post('/api/events')
        .send({ name: 'Un mariage en juin', slug: 'chez-lea' })

      expect(response.status).toBe(201)
      expect(response.body.slug).toBe('chez-lea')
    })

    it('takes a start date and a quota when the host sets them', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.post('/api/events').send({
        name: 'Un mariage en juin',
        startsAt: '2026-06-20T19:00:00.000Z',
        quotaBytes: 1_500_000_000,
      })

      expect(response.status).toBe(201)
      expect(response.body).toMatchObject({
        startsAt: '2026-06-20T19:00:00.000Z',
        quotaBytes: 1_500_000_000,
      })
    })

    it('reads an explicit null as "not set", which is what the form sends', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .post('/api/events')
        .send({ name: 'Un mariage en juin', startsAt: null, quotaBytes: null })

      expect(response.status).toBe(201)
      expect(response.body.startsAt).toBeNull()
      // The configured default, not zero and not the absence of a quota.
      expect(response.body.quotaBytes).toBe(DEFAULT_QUOTA_BYTES)
    })

    it('answers 409 for a slug another event already holds', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.post('/api/events').send({ name: 'Encore un', slug: SLUG })

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('event.slugTaken')
    })
  })

  describe('GET /api/events/:slug', () => {
    it('answers with the full event, its settings and its counts', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.get(`/api/events/${SLUG}`)

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        id: WEDDING,
        slug: SLUG,
        joinCode: 'H7K2QM',
        joinUrl: 'http://localhost:4300/join/H7K2QM',
        role: 'owner',
        quotaBytes: 5_000_000_000,
        photoCount: 2,
        pendingCount: 1,
        guestCount: 3,
        usedBytes: 3_000_000,
        settings: {
          moderation: 'manual',
          allowCaptions: true,
          allowReactions: true,
          allowGuestSelfDelete: true,
          guestSelfDeleteGraceSeconds: 900,
          retentionDays: 30,
          maxPhotosPerGuest: 20,
        },
      })
    })

    it('gives a moderator the same event, with their own role', async () => {
      const agent = await signedIn(world, 'moderator')

      const response = await agent.get(`/api/events/${SLUG}`)

      expect(response.status).toBe(200)
      expect(response.body.role).toBe('moderator')
    })
  })

  describe('PATCH /api/events/:slug', () => {
    it('renames the event and answers with it', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.patch(`/api/events/${SLUG}`).send({ name: 'Camille et Sacha' })

      expect(response.status).toBe(200)
      expect(response.body.name).toBe('Camille et Sacha')
      expect((await world.events.findById(WEDDING))?.name.value).toBe('Camille et Sacha')
    })

    it('leaves the slug alone, because it is the projector page address', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.patch(`/api/events/${SLUG}`).send({ name: 'Camille et Sacha' })

      expect(response.body.slug).toBe(SLUG)
    })
  })

  describe('PATCH /api/events/:slug/settings', () => {
    it('changes only the fields the host sent', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .patch(`/api/events/${SLUG}/settings`)
        .send({ moderation: 'auto' })

      expect(response.status).toBe(200)
      expect(response.body.settings).toMatchObject({
        moderation: 'auto',
        // Absent from the request, so untouched. A default filled in here would turn
        // "do not touch retention" into "keep forever".
        retentionDays: 30,
        maxPhotosPerGuest: 20,
      })
    })

    it('clears retention when the host sends null', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .patch(`/api/events/${SLUG}/settings`)
        .send({ retentionDays: null })

      expect(response.status).toBe(200)
      expect(response.body.settings.retentionDays).toBeNull()
    })

    it('applies every field of a full patch', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.patch(`/api/events/${SLUG}/settings`).send({
        moderation: 'auto',
        allowCaptions: false,
        allowReactions: false,
        allowGuestSelfDelete: false,
        guestSelfDeleteGraceSeconds: 60,
        retentionDays: 7,
        maxPhotosPerGuest: 5,
      })

      expect(response.status).toBe(200)
      expect(response.body.settings).toEqual({
        moderation: 'auto',
        allowCaptions: false,
        allowReactions: false,
        allowGuestSelfDelete: false,
        guestSelfDeleteGraceSeconds: 60,
        retentionDays: 7,
        maxPhotosPerGuest: 5,
      })
    })
  })

  describe('PATCH /api/events/:slug/schedule', () => {
    it('stores both instants and answers with the event carrying them', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .patch(`/api/events/${SLUG}/schedule`)
        .send({ scheduledOpenAt: SCHEDULED_OPEN_AT, scheduledCloseAt: SCHEDULED_CLOSE_AT })

      expect(response.status).toBe(200)
      expect(response.body.scheduledOpenAt).toBe(SCHEDULED_OPEN_AT)
      expect(response.body.scheduledCloseAt).toBe(SCHEDULED_CLOSE_AT)
      expect((await world.events.findById(WEDDING))?.scheduledOpenAt).toEqual(
        new Date(SCHEDULED_OPEN_AT),
      )
    })

    it('accepts a null half, which is a host who will do that one by hand', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .patch(`/api/events/${SLUG}/schedule`)
        .send({ scheduledOpenAt: SCHEDULED_OPEN_AT, scheduledCloseAt: null })

      expect(response.status).toBe(200)
      expect(response.body.scheduledCloseAt).toBeNull()
    })

    it('clears the schedule when both halves are null', async () => {
      const agent = await signedIn(world, 'owner')
      await agent
        .patch(`/api/events/${SLUG}/schedule`)
        .send({ scheduledOpenAt: SCHEDULED_OPEN_AT, scheduledCloseAt: SCHEDULED_CLOSE_AT })

      const response = await agent
        .patch(`/api/events/${SLUG}/schedule`)
        .send({ scheduledOpenAt: null, scheduledCloseAt: null })

      expect(response.status).toBe(200)
      expect(response.body.scheduledOpenAt).toBeNull()
      expect(response.body.scheduledCloseAt).toBeNull()
    })

    it('answers 400 for a closing that comes before the opening', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .patch(`/api/events/${SLUG}/schedule`)
        .send({ scheduledOpenAt: SCHEDULED_CLOSE_AT, scheduledCloseAt: SCHEDULED_OPEN_AT })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('event.scheduleOutOfOrder')
    })

    it('answers 400 for an instant that has already gone by', async () => {
      // The host arms the closing at 21:30 and leaves the date on today. Nothing below
      // this route would have stopped it, and the sweep would end the party.
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .patch(`/api/events/${SLUG}/schedule`)
        .send({ scheduledOpenAt: null, scheduledCloseAt: ALREADY_PAST })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('event.scheduleInPast')
      expect((await world.events.findById(WEDDING))?.scheduledCloseAt).toBeNull()
    })

    it('accepts an instant carrying an offset other than Z', async () => {
      // A third-party client in Paris sends `+02:00`, which is an ordinary RFC-3339
      // instant. `z.string().datetime()` without `{ offset: true }` refuses it, and the
      // contract in docs/API.md §6 says it is accepted.
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .patch(`/api/events/${SLUG}/schedule`)
        .send({ scheduledOpenAt: '2026-06-21T00:00:00+02:00', scheduledCloseAt: null })

      expect(response.status).toBe(200)
      // Normalised to UTC on the way out: 00:00+02:00 is 22:00Z the day before.
      expect(response.body.scheduledOpenAt).toBe('2026-06-20T22:00:00.000Z')
    })

    it('reports a schedule the sweep threw away, so the host learns it is gone', async () => {
      const agent = await signedIn(world, 'owner')
      world.events.seed(
        anEvent({
          id: WEDDING,
          ownerId: OWNER,
          slug: SLUG,
          joinCode: 'H7K2QM',
          status: 'draft',
          scheduleDiscardedAt: AT,
        }),
      )

      const response = await agent.get(`/api/events/${SLUG}`)

      expect(response.body.scheduleDiscardedAt).toBe(AT.toISOString())
    })

    it('clears that notice when the host saves a new schedule', async () => {
      const agent = await signedIn(world, 'owner')
      world.events.seed(
        anEvent({
          id: WEDDING,
          ownerId: OWNER,
          slug: SLUG,
          joinCode: 'H7K2QM',
          status: 'draft',
          scheduleDiscardedAt: AT,
        }),
      )

      const response = await agent
        .patch(`/api/events/${SLUG}/schedule`)
        .send({ scheduledOpenAt: SCHEDULED_OPEN_AT, scheduledCloseAt: null })

      expect(response.status).toBe(200)
      expect(response.body.scheduleDiscardedAt).toBeNull()
    })

    it('reports the schedule on every later read of the event', async () => {
      const agent = await signedIn(world, 'owner')
      await agent
        .patch(`/api/events/${SLUG}/schedule`)
        .send({ scheduledOpenAt: SCHEDULED_OPEN_AT, scheduledCloseAt: SCHEDULED_CLOSE_AT })

      const response = await agent.get(`/api/events/${SLUG}`)

      expect(response.body.scheduledOpenAt).toBe(SCHEDULED_OPEN_AT)
      // Untouched by the schedule: `startsAt` is the printed start of the party.
      expect(response.body.startsAt).toBeNull()
    })
  })

  describe('POST /api/events/:slug/status', () => {
    it('opens the doors: a draft event becomes live', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.post(`/api/events/${SLUG}/status`).send({ status: 'live' })

      expect(response.status).toBe(200)
      expect(response.body.status).toBe('live')
      expect((await world.events.findById(WEDDING))?.status).toBe('live')
    })

    it('answers 409 for a transition the lifecycle forbids', async () => {
      // A draft event has never run, so there is nothing to close.
      const agent = await signedIn(world, 'owner')

      const response = await agent.post(`/api/events/${SLUG}/status`).send({ status: 'closed' })

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('event.illegalTransition')
    })
  })

  describe('POST /api/events/:slug/join-code', () => {
    it('rotates the code, so a link circulating outside the venue stops working', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.post(`/api/events/${SLUG}/join-code`)

      expect(response.status).toBe(200)
      expect(response.body.joinCode).not.toBe('H7K2QM')
      expect((await world.events.findById(WEDDING))?.joinCode.value).toBe(response.body.joinCode)
    })

    it('answers with the new join URL, so the console can reprint the QR', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.post(`/api/events/${SLUG}/join-code`)

      expect(response.body.joinUrl).toBe(
        `http://localhost:4300/join/${String(response.body.joinCode)}`,
      )
    })
  })

  describe('DELETE /api/events/:slug', () => {
    it('purges the album and answers 204', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.delete(`/api/events/${SLUG}`)

      expect(response.status).toBe(204)
      expect(await world.events.findById(WEDDING)).toBeNull()
    })

    it('removes the media too, so no bytes are left with nothing to find them by', async () => {
      const agent = await signedIn(world, 'owner')

      await agent.delete(`/api/events/${SLUG}`)

      expect(world.media.purged).toEqual([WEDDING])
    })

    it('leaves another event untouched', async () => {
      const agent = await signedIn(world, 'owner')

      await agent.delete(`/api/events/${SLUG}`)

      expect(await world.events.findById(GALA)).not.toBeNull()
    })
  })

  describe('GET /api/events/:slug/guests', () => {
    it("lists this event's guests, most recently seen first, revoked ones included", async () => {
      const agent = await signedIn(world, 'moderator')

      const response = await agent.get(`/api/events/${SLUG}/guests`)

      expect(response.status).toBe(200)
      expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([
        WEDDING_GUEST,
        REVOKED_GUEST,
        AWAY_GUEST,
      ])
      // A removal the host cannot see afterwards looks like a button that did nothing.
      expect(response.body.items).toContainEqual(
        expect.objectContaining({ id: REVOKED_GUEST, revoked: true }),
      )
    })

    it('counts only the guests who are in the room now', async () => {
      // One seen just now, one seen half an hour ago, one revoked.
      const agent = await signedIn(world, 'moderator')

      const response = await agent.get(`/api/events/${SLUG}/guests`)

      expect(response.body.activeCount).toBe(1)
    })

    /**
     * The half a 400 alone does not state.
     *
     * `AWAY_GUEST` was last seen half an hour ago — inside the window the removed
     * `activeWithinMinutes` defaulted to, outside the five minutes `listGuests` has
     * always used. A host who sent the old default got this answer and read it as the
     * thirty-minute one. The endpoint now has exactly one answer, and this is it.
     */
    it('answers one presence window and refuses to be asked for another', async () => {
      const agent = await signedIn(world, 'moderator')

      const plain = await agent.get(`/api/events/${SLUG}/guests`)
      const asked = await agent.get(`/api/events/${SLUG}/guests?activeWithinMinutes=30`)

      expect(plain.status).toBe(200)
      // Half an hour ago is not "in the room now", whatever a caller asks for.
      expect(plain.body.items.map((item: { id: string }) => item.id)).toContain(AWAY_GUEST)
      expect(plain.body.activeCount).toBe(1)
      expect(asked.status).toBe(400)
      expect(asked.body.error.code).toBe('request.invalid')
    })

    it('never lists a guest of another event', async () => {
      const agent = await signedIn(world, 'moderator')

      const response = await agent.get(`/api/events/${SLUG}/guests`)

      expect(response.body.items.map((item: { id: string }) => item.id)).not.toContain(GALA_GUEST)
    })
  })

  describe('POST /api/events/:slug/guests/:guestId/revoke', () => {
    it('cuts off a disruptive guest and answers 204', async () => {
      const agent = await signedIn(world, 'moderator')

      const response = await agent.post(`/api/events/${SLUG}/guests/${WEDDING_GUEST}/revoke`)

      expect(response.status).toBe(204)
      const guest = await world.guests.findById(WEDDING, asGuestId(WEDDING_GUEST))
      expect(guest?.isRevoked()).toBe(true)
    })

    it('is idempotent: the button is on a phone and will be double-tapped', async () => {
      const agent = await signedIn(world, 'moderator')

      await agent.post(`/api/events/${SLUG}/guests/${WEDDING_GUEST}/revoke`).expect(204)
      const response = await agent.post(`/api/events/${SLUG}/guests/${WEDDING_GUEST}/revoke`)

      expect(response.status).toBe(204)
    })

    it("answers 404 for another event's guest", async () => {
      // The gala's guest exists, and a 403 would say so.
      const agent = await signedIn(world, 'moderator')

      const response = await agent.post(`/api/events/${SLUG}/guests/${GALA_GUEST}/revoke`)

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('guest.notFound')
    })
  })

  describe('GET /api/events/:slug/moderators', () => {
    it('lists who holds the console for this event', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.get(`/api/events/${SLUG}/moderators`)

      expect(response.status).toBe(200)
      expect(response.body.items).toEqual([
        {
          userId: MODERATOR,
          email: 'moderateur@example.test',
          displayName: null,
          role: 'moderator',
          grantedAt: atPlus(1_000).toISOString(),
        },
        {
          userId: OWNER,
          email: 'hote@example.test',
          displayName: 'Camille',
          role: 'owner',
          grantedAt: AT.toISOString(),
        },
      ])
    })

    it("never lists another event's memberships", async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.get(`/api/events/${SLUG}/moderators`)

      expect(response.body.items.map((item: { userId: string }) => item.userId)).not.toContain(
        GALA_OWNER,
      )
    })
  })

  describe('POST /api/events/:slug/moderators', () => {
    it('creates the account with a single-use password and grants the role', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .post(`/api/events/${SLUG}/moderators`)
        .send({ email: 'lea@example.test', temporaryPassword: TEMPORARY_PASSWORD })

      expect(response.status).toBe(201)
      expect(response.body.created).toBe(true)
      const invited = asUserId(String(response.body.userId))
      // Someone else chose this password and said it out loud, so it is single-use.
      expect((await world.users.findById(invited))?.mustChangePassword).toBe(true)
      expect(await world.memberships.roleFor(WEDDING, invited)).toBe('moderator')
    })

    it('grants the role on this event only', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .post(`/api/events/${SLUG}/moderators`)
        .send({ email: 'lea@example.test', temporaryPassword: TEMPORARY_PASSWORD })

      const invited = asUserId(String(response.body.userId))
      expect(await world.memberships.roleFor(GALA, invited)).toBeNull()
    })

    it('answers 409 for an address that already has a role on this event', async () => {
      // Re-inviting would otherwise silently downgrade a co-owner to moderator.
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .post(`/api/events/${SLUG}/moderators`)
        .send({ email: 'moderateur@example.test', temporaryPassword: TEMPORARY_PASSWORD })

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('membership.alreadyExists')
    })

    it('keeps an existing account, and says the password was not needed', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .post(`/api/events/${SLUG}/moderators`)
        .send({ email: 'nouvelle@example.test', temporaryPassword: TEMPORARY_PASSWORD })

      expect(response.status).toBe(201)
      expect(response.body).toEqual({ userId: NEWCOMER, created: false })
    })
  })

  describe('DELETE /api/events/:slug/moderators/:userId', () => {
    it('takes the console back and answers 204', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.delete(`/api/events/${SLUG}/moderators/${MODERATOR}`)

      expect(response.status).toBe(204)
      expect(await world.memberships.roleFor(WEDDING, asUserId(MODERATOR))).toBeNull()
    })

    it('refuses to remove the only owner, which would leave the album unowned', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.delete(`/api/events/${SLUG}/moderators/${OWNER}`)

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('membership.lastOwner')
      expect(await world.memberships.roleFor(WEDDING, asUserId(OWNER))).toBe('owner')
    })

    it('answers 404 for someone who holds no membership on this event', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.delete(`/api/events/${SLUG}/moderators/${NEWCOMER}`)

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('membership.notFound')
    })
  })
})

/**
 * Enough of a `Logger` to build a `RequestContext`. The interface layer may not reach
 * into `src/infrastructure`, so the real pino logger is out of bounds here.
 */
const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
}

describe('the guards in front of every handler', () => {
  const bare: RequestContext = { requestId: 'req-1', logger: silent }

  it('fails loudly when a route is mounted without requireUser', () => {
    // Never a fallback principal. A mis-wired route has to break rather than quietly
    // serve an anonymous caller, which is how 1.0 let one session reach every party.
    expect(() => currentUser(bare)).toThrow(/mis-wired/)
  })

  it('fails loudly when a route is mounted without requireRole', () => {
    // A principal, but no resolved event: the handler would otherwise have to pick an
    // event id itself, which is the one thing it must never do.
    const signedInOnly: RequestContext = {
      ...bare,
      user: {
        kind: 'user',
        userId: asUserId(OWNER),
        email: 'hote@example.test',
        mustChangePassword: false,
      },
    }

    expect(() => hostScope(signedInOnly)).toThrow(/mis-wired/)
  })
})
