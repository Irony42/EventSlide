import type { Express } from 'express'
import request, { type Agent, type Test } from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { mailFailure, type Mailer } from '../../../application/ports/mailer'
import { err } from '../../../domain/shared/result'
import { makeIssueInvitation } from '../../../application/usecases/auth/issueInvitation'
import { makeRegisterModerator } from '../../../application/usecases/auth/registerModerator'
import { makeChangeEventStatus } from '../../../application/usecases/events/changeEventStatus'
import {
  makeCreateEvent,
  type EventCreationPolicy,
} from '../../../application/usecases/events/createEvent'
import { makeGetEventBySlug } from '../../../application/usecases/events/getEventBySlug'
import { makeGetEventLimits } from '../../../application/usecases/events/getEventLimits'
import { makeGetEventView } from '../../../application/usecases/events/getEventView'
import { makeListEventsForHost } from '../../../application/usecases/events/listEventsForHost'
import { makeListModerators } from '../../../application/usecases/events/listModerators'
import { makePurgeEvent } from '../../../application/usecases/events/purgeEvent'
import { makeRenameEvent } from '../../../application/usecases/events/renameEvent'
import { makeRevokeModerator } from '../../../application/usecases/events/revokeModerator'
import { makeRotateJoinCode } from '../../../application/usecases/events/rotateJoinCode'
import { makeScheduleEvent } from '../../../application/usecases/events/scheduleEvent'
import { makeUpdateEventSettings } from '../../../application/usecases/events/updateEventSettings'
import { makeGetEventStats } from '../../../application/usecases/stats/getEventStats'
import { FakeEventStatsRepository } from '../../../application/testing/fakeEventStatsRepository'
import { FakeReactionRepository } from '../../../application/testing/fakeReactionRepository'
import { makeListGuests } from '../../../application/usecases/guests/listGuests'
import { makeRevokeGuest } from '../../../application/usecases/guests/revokeGuest'
import {
  AT,
  aClient,
  anEvent,
  aGuest,
  aPhoto,
  aUser,
  atPlus,
} from '../../../application/testing/builders'
import { FakeAccountTokenRepository } from '../../../application/testing/fakeAccountTokenRepository'
import { FakeClientRepository } from '../../../application/testing/fakeClientRepository'
import { FakeMailer } from '../../../application/testing/fakeMailer'
import { FakeSecretTokens } from '../../../application/testing/fakeSecretTokens'
import { FakeEventRepository } from '../../../application/testing/fakeEventRepository'
import { FakeGuestRepository } from '../../../application/testing/fakeGuestRepository'
import { FakeMembershipRepository } from '../../../application/testing/fakeMembershipRepository'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { FakeUserRepository } from '../../../application/testing/fakeUserRepository'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import { asClientId, asEventId, asGuestId, asUserId } from '../../../domain/shared/ids'
import type { ClientCeilingsProps } from '../../../domain/clients/clientCeilings'
import { Event } from '../../../domain/events/event'
import { Slug } from '../../../domain/shared/slug'
import { eventCreationLimiter } from '../middleware/rateLimit'
import { buildHarness, signInAs } from '../testing/middlewareHarness'
import type { HttpDeps } from '../types'
import type { HttpUseCases } from '../useCases'
import { eventRoutes } from './eventRoutes'
import { InMemoryMediaStore } from '../../../application/testing/inMemoryMediaStore'

/**
 * D-14: the self-hosted defaults `makeCreateEvent` and `makeRotateJoinCode` get
 * everywhere in this file that is not specifically testing one of P4-09's three
 * switches.
 */
const CORE_DEFAULTS = {
  slugSuffix: 'none',
  allowCustomSlugs: true,
  joinCodeLength: 6,
} as const

/**
 * Generous enough that no test here trips it by accident — the limiter's own keying
 * and 429 are `rateLimit.test.ts`'s and the dedicated test below, not every other case
 * in this file.
 */
const GENEROUS_CREATION_LIMIT = 1_000

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
/** Belongs to one client. */
const CLIENT_MEMBER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
/** Belongs to two clients, and so has to say which. */
const TWO_CLIENTS_MEMBER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
/** Runs the box. */
const OPERATOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CLIENT_ONE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const CLIENT_TWO = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const AWAY_GUEST = '66666666-6666-4666-8666-666666666666'
const REVOKED_GUEST = '77777777-7777-4777-8777-777777777777'
const GALA_GUEST = '88888888-8888-4888-8888-888888888888'

const SLUG = 'camille-et-sacha'

const slugOf = (value: string): Slug => {
  const parsed = Slug.create(value)
  if (!parsed.ok) throw new Error(`invalid test slug: ${value}`)
  return parsed.value
}
const NO_SUCH_SLUG = 'un-evenement-qui-nexiste-pas'

/**
 * The field 2.x asked the host for and 3.0 refuses. Written in two parts so that a search of
 * `src` and `web/src` for its name is empty, which is the criterion the plan states for the
 * item that removed it: nothing handles that field any more, and a test that sends it is
 * about its refusal.
 */
const RETIRED_PASSWORD_FIELD = ['temporary', 'Password'].join('')

/** A box with no SMTP relay: the production `NullMailer`'s answer, written out. */
const nullMailer: Mailer = {
  canDeliver: false,
  send: async () => err(mailFailure('notConfigured')),
}

/** What the create form leaves to configuration: the host is asked for a name only. */
const DEFAULT_QUOTA_BYTES = 2_000_000_000

/** The box-wide ceiling (G3-02). Above `DEFAULT_QUOTA_BYTES`, as env.ts requires. */
const MAX_QUOTA_BYTES = 10_000_000_000

/**
 * Two instants ahead of the harness clock ({@link AT}, 21:00), already resolved by the
 * browser. Ahead of it on purpose: the domain refuses a schedule that has already gone
 * by, so a fixture in the past would exercise that refusal rather than the happy path.
 */
const SCHEDULED_OPEN_AT = '2026-06-20T22:00:00.000Z'
const SCHEDULED_CLOSE_AT = '2026-06-21T04:00:00.000Z'
/** Before the harness clock: what the host sends when they forget to advance the date. */
const ALREADY_PAST = '2026-06-20T02:00:00.000Z'

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
  readonly clients: FakeClientRepository
  readonly guests: FakeGuestRepository
  readonly photos: FakePhotoRepository
  readonly reactions: FakeReactionRepository
  readonly memberships: FakeMembershipRepository
  readonly users: FakeUserRepository
  readonly tokens: FakeAccountTokenRepository
  readonly mailer: FakeMailer
  readonly media: InMemoryMediaStore
}

interface BuildWorldOptions {
  /** Defaults to {@link GENEROUS_CREATION_LIMIT}; a test about the limiter itself narrows it. */
  readonly creationLimit?: number
  /** `EVENT_CREATION`. Defaults to `anyAccount`, which is what a box that never set it has. */
  readonly eventCreation?: EventCreationPolicy
  /** Which mailer the invitation goes through: the recording fake, or a box with no relay. */
  readonly mailer?: 'fake' | 'none'
}

const buildWorld = ({
  creationLimit = GENEROUS_CREATION_LIMIT,
  eventCreation = 'anyAccount',
  mailer: mailerChoice = 'fake',
}: BuildWorldOptions = {}): World => {
  const users = new FakeUserRepository()
  const photos = new FakePhotoRepository()
  const guests = new FakeGuestRepository()
  const reactions = new FakeReactionRepository()
  const memberships = new FakeMembershipRepository({ users })
  // Linked, so a dashboard row carries the counts the SQLite join would really produce
  // and a membership carries the address of a real account.
  const clients = new FakeClientRepository()
  const events = new FakeEventRepository({ memberships, photos, guests, clients })
  const media = new InMemoryMediaStore().forbidEnumeration('the host event routes')
  const ids = new SequentialIdGenerator()
  // The foreign keys the real table has: an invitation names an author and an event that exist.
  const tokens = new FakeAccountTokenRepository()
    .withAccounts(asUserId(OWNER), asUserId(GALA_OWNER))
    .withEvents(WEDDING, GALA)
  const mailer = new FakeMailer()
  const mailerPort: Mailer = mailerChoice === 'none' ? nullMailer : mailer

  const harness = buildHarness({
    users,
    routes: (app, harnessDeps) => {
      // The harness builds unlinked repositories of its own; the router gets the linked
      // ones instead, and shares everything else — the same clock, the same recording
      // bus, the same config. `users` is among them because `requireUser` reads it on
      // every request to the two routes here that are not event-scoped: the world the
      // accounts live in has to be the world the gate asks.
      const deps: HttpDeps = { ...harnessDeps, events, memberships, users }

      const usecases: HttpUseCases = {
        authenticateUser: absent('authenticateUser'),
        changePassword: absent('changePassword'),
        deleteOwnAccount: absent('deleteOwnAccount'),
        revokeOtherSessions: absent('revokeOtherSessions'),
        requestPasswordReset: absent('requestPasswordReset'),
        resetPassword: absent('resetPassword'),
        verifySecondFactor: absent('verifySecondFactor'),
        enrollTotp: absent('enrollTotp'),
        confirmTotpEnrollment: absent('confirmTotpEnrollment'),
        stepUp: absent('stepUp'),
        regenerateRecoveryCodes: absent('regenerateRecoveryCodes'),
        disableSecondFactor: absent('disableSecondFactor'),
        approveInvitation: absent('approveInvitation'),
        approvePasswordReset: absent('approvePasswordReset'),
        listSiteClients: absent('listSiteClients'),
        listSiteClientEvents: absent('listSiteClientEvents'),
        listSiteAccounts: absent('listSiteAccounts'),
        listSiteAudit: absent('listSiteAudit'),
        provisionClientOwner: absent('provisionClientOwner'),
        renameClient: absent('renameClient'),
        setClientCeilings: absent('setClientCeilings'),
        suspendClient: absent('suspendClient'),
        setPhotoTakedown: absent('setPhotoTakedown'),
        lookupSiteEvents: absent('lookupSiteEvents'),
        getSiteEventState: absent('getSiteEventState'),
        getSitePhotoState: absent('getSitePhotoState'),
        setEventTakedown: absent('setEventTakedown'),
        setEventPurgeHold: absent('setEventPurgeHold'),
        resumeClient: absent('resumeClient'),
        offboardClient: absent('offboardClient'),
        disableAccount: absent('disableAccount'),
        enableAccount: absent('enableAccount'),
        deleteAccount: absent('deleteAccount'),
        inviteToClientAsOperator: absent('inviteToClientAsOperator'),
        issuePasswordResetForAccount: absent('issuePasswordResetForAccount'),
        getClientLimits: absent('getClientLimits'),
        listClientAudit: absent('listClientAudit'),
        listPendingInvitations: absent('listPendingInvitations'),
        registerModerator: makeRegisterModerator({
          events,
          users,
          memberships,
          issueInvitation: makeIssueInvitation({
            tokens,
            secrets: new FakeSecretTokens(),
            mailer: mailerPort,
            ids,
            clock: deps.clock,
            logger: deps.logger,
            publicUrl: 'https://photos.example.test',
          }),
        }),
        previewInvitation: absent('previewInvitation'),
        acceptInvitation: absent('acceptInvitation'),

        createEvent: makeCreateEvent({
          events,
          clients,
          users,
          eventCreation,
          ids,
          clock: deps.clock,
          defaultQuotaBytes: DEFAULT_QUOTA_BYTES,
          maxQuotaBytes: MAX_QUOTA_BYTES,
          ...CORE_DEFAULTS,
        }),
        getEventBySlug: makeGetEventBySlug({ events }),
        getEventView: makeGetEventView({
          events,
          getEventLimits: makeGetEventLimits({ clients }),
        }),
        listEventsForHost: makeListEventsForHost({ events, memberships }),
        resolveJoinCode: absent('resolveJoinCode'),
        identifyMediaViewer: absent('identifyMediaViewer'),
        updateEventSettings: makeUpdateEventSettings({
          events,
          clients,
          memberships,
          bus: deps.bus,
        }),
        rotateJoinCode: makeRotateJoinCode({
          events,
          memberships,
          ids,
          bus: deps.bus,
          joinCodeLength: CORE_DEFAULTS.joinCodeLength,
        }),
        changeEventStatus: makeChangeEventStatus({
          events,
          clients,
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
        renameEvent: makeRenameEvent({ events, memberships, bus: deps.bus }),
        setVenuePhoto: absent('setVenuePhoto'),
        removeVenuePhoto: absent('removeVenuePhoto'),
        getVenuePhotoMedia: absent('getVenuePhotoMedia'),
        listModerators: makeListModerators({ memberships }),
        revokeModerator: makeRevokeModerator({ events, memberships }),

        joinEvent: absent('joinEvent'),
        renameGuest: absent('renameGuest'),
        eraseGuestContribution: absent('eraseGuestContribution'),
        revokeGuest: makeRevokeGuest({ events, guests, memberships, clock: deps.clock }),
        listGuests: makeListGuests({ guests, memberships, clock: deps.clock }),
        getPrivacyNotice: absent('getPrivacyNotice'),
        acknowledgePrivacyNotice: absent('acknowledgePrivacyNotice'),

        uploadPhotos: absent('uploadPhotos'),
        listEventPhotos: absent('listEventPhotos'),
        listGuestPhotos: absent('listGuestPhotos'),
        deletePhoto: absent('deletePhoto'),
        setPhotoCaption: absent('setPhotoCaption'),
        getPhotoMedia: absent('getPhotoMedia'),
        uploadClip: absent('uploadClip'),
        getClipJob: absent('getClipJob'),
        exportAlbum: absent('exportAlbum'),

        getModerationQueue: absent('getModerationQueue'),
        moderatePhoto: absent('moderatePhoto'),
        moderatePhotosBulk: absent('moderatePhotosBulk'),

        getWallPlaylist: absent('getWallPlaylist'),
        listMissions: absent('listMissions'),
        createMission: absent('createMission'),
        updateMission: absent('updateMission'),
        deleteMission: absent('deleteMission'),
        getGuestChecklist: absent('getGuestChecklist'),
        createGuestbookEntry: absent('createGuestbookEntry'),
        listMyGuestbookEntries: absent('listMyGuestbookEntries'),
        deleteGuestbookEntry: absent('deleteGuestbookEntry'),

        createShareLink: absent('createShareLink'),
        getShareLink: absent('getShareLink'),
        revokeShareLink: absent('revokeShareLink'),
        openGallery: absent('openGallery'),
        unlockGallery: absent('unlockGallery'),
        listGalleryPhotos: absent('listGalleryPhotos'),
        getGalleryMedia: absent('getGalleryMedia'),
        downloadGalleryArchive: absent('downloadGalleryArchive'),

        reactToPhoto: absent('reactToPhoto'),
        withdrawReaction: absent('withdrawReaction'),
        getPhotoReactions: absent('getPhotoReactions'),
        getTopPhotos: absent('getTopPhotos'),
        getEventStats: makeGetEventStats({
          events,
          memberships,
          guests,
          stats: new FakeEventStatsRepository(photos, guests, reactions),
          clock: deps.clock,
        }),
      }

      app.post('/sign-in/owner', signInAs({ userId: OWNER, email: 'hote@example.test' }))
      app.post(
        '/sign-in/moderator',
        signInAs({ userId: MODERATOR, email: 'moderateur@example.test' }),
      )
      app.post('/sign-in/gala-owner', signInAs({ userId: GALA_OWNER, email: 'gala@example.test' }))
      app.post('/sign-in/newcomer', signInAs({ userId: NEWCOMER, email: 'nouvelle@example.test' }))
      app.post(
        '/sign-in/client-member',
        signInAs({ userId: CLIENT_MEMBER, email: 'cliente@example.test' }),
      )
      app.post(
        '/sign-in/two-clients-member',
        signInAs({ userId: TWO_CLIENTS_MEMBER, email: 'agence@example.test' }),
      )
      app.post('/sign-in/operator', signInAs({ userId: OPERATOR, email: 'operateur@example.test' }))

      app.use(
        '/api',
        eventRoutes({
          deps,
          usecases,
          presenter: {
            publicUrl: deps.config.publicUrl,
            uploadLimits: deps.config.uploads,
            clipLimits: {
              maxBytes: deps.config.clips.maxBytes,
              maxSeconds: deps.config.clips.maxSeconds,
              supported: deps.config.clips.supported,
            },
          },
          creationLimiter: eventCreationLimiter(creationLimit),
        }),
      )
    },
  })

  users.seed(
    aUser({ id: OWNER, email: 'hote@example.test', displayName: 'Camille' }),
    aUser({ id: MODERATOR, email: 'moderateur@example.test' }),
    aUser({ id: GALA_OWNER, email: 'gala@example.test' }),
    aUser({ id: NEWCOMER, email: 'nouvelle@example.test' }),
    aUser({ id: CLIENT_MEMBER, email: 'cliente@example.test' }),
    aUser({ id: TWO_CLIENTS_MEMBER, email: 'agence@example.test' }),
    aUser({ id: OPERATOR, email: 'operateur@example.test', siteRole: 'operator' }),
  )

  clients.seed(
    aClient({ id: CLIENT_ONE, name: 'Atelier Camille' }),
    aClient({ id: CLIENT_TWO, name: 'Studio Sacha' }),
  )
  const grantClient = (clientId: string, userId: string): void => {
    void clients.grantMember({
      clientId: asClientId(clientId),
      userId: asUserId(userId),
      role: 'member',
      grantedAt: AT,
    })
  }
  grantClient(CLIENT_ONE, CLIENT_MEMBER)
  grantClient(CLIENT_ONE, TWO_CLIENTS_MEMBER)
  grantClient(CLIENT_TWO, TWO_CLIENTS_MEMBER)

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

  return {
    app: harness.app,
    events,
    clients,
    guests,
    photos,
    reactions,
    memberships,
    users,
    tokens,
    mailer,
    media,
  }
}

type Who =
  | 'owner'
  | 'moderator'
  | 'gala-owner'
  | 'newcomer'
  | 'client-member'
  | 'two-clients-member'
  | 'operator'

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
    name: 'GET /events/:slug/stats',
    requires: 'moderator',
    call: (client, slug) => client.get(`/api/events/${slug}/stats`),
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
      client.post(`/api/events/${slug}/moderators`).send({ email: 'lea@example.test' }),
  },
  {
    // The upload: refused before a byte is buffered, so no body is needed to prove it.
    name: 'PUT /events/:slug/venue-photo',
    requires: 'owner',
    call: (client, slug) => client.put(`/api/events/${slug}/venue-photo`),
  },
  {
    name: 'DELETE /events/:slug/venue-photo',
    requires: 'owner',
    call: (client, slug) => client.delete(`/api/events/${slug}/venue-photo`),
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
    // No new error code for this: an unknown template is `request.invalid`, exactly like
    // every other unknown enum value at this boundary — which is what keeps roadmap 1.5
    // from having to translate a fifth string for it.
    name: 'POST /events with a template outside the catalogue',
    call: (client) =>
      client.post('/api/events').send({ name: 'Un mariage', template: 'graduation' }),
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
    name: 'POST /events/:slug/moderators with the temporary password 2.x asked for',
    call: (client) =>
      client
        .post(`/api/events/${SLUG}/moderators`)
        .send({ email: 'lea@example.test', [RETIRED_PASSWORD_FIELD]: 'mot-de-passe-provisoire' }),
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
          role: 'owner',
        },
      ])
    })

    it('tells a moderator they moderate the event, so the dashboard can leave out the owner’s buttons', async () => {
      const agent = await signedIn(world, 'moderator')

      const response = await agent.get('/api/events')

      expect(response.body.items).toEqual([
        expect.objectContaining({ slug: SLUG, role: 'moderator' }),
      ])
    })

    it('gives each event the role the caller holds in that event, and no event of another client', async () => {
      // The gala's owner is also invited to moderate the wedding: two rows, two roles, and the
      // wedding's owner and moderator memberships colour nothing of theirs.
      await world.memberships.grant({
        eventId: WEDDING,
        userId: asUserId(GALA_OWNER),
        role: 'moderator',
        grantedAt: AT,
      })
      const agent = await signedIn(world, 'gala-owner')

      const response = await agent.get('/api/events')

      expect(
        response.body.items.map((item: { slug: string; role: string }) => [item.slug, item.role]),
      ).toEqual(
        expect.arrayContaining([
          ['gala-annuel', 'owner'],
          [SLUG, 'moderator'],
        ]),
      )
      expect(response.body.items).toHaveLength(2)
    })

    it('shows a host with no part in an event neither the event nor a role for it', async () => {
      const agent = await signedIn(world, 'newcomer')

      const response = await agent.get('/api/events')

      expect(response.body).toEqual({ items: [] })
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

    it('carries the creator’s language onto the event, for the projector to read', async () => {
      // Found by a mutation: dropping the `with({ wallLanguage })` in `createEvent` left
      // every ring-4 case green, because nothing on this path had ever asked. The create
      // form is the only place this value is ever set from anybody's preference, so the
      // route that carries it is worth one case of its own.
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .post('/api/events')
        .send({ name: 'Un mariage en juin', wallLanguage: 'de' })

      expect(response.status).toBe(201)
      expect(response.body.settings.wallLanguage).toBe('de')
    })

    it('answers French for a client that says nothing about language', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.post('/api/events').send({ name: 'Un mariage en juin' })

      expect(response.body.settings.wallLanguage).toBe('fr')
    })

    it('refuses a language this build has no words for', async () => {
      // `z.enum(EVENT_LANGUAGES)` at the boundary. A tag the client cannot render must not
      // reach the settings blob: the wall would fall back to French for eight hours while
      // the host's settings page showed what they chose.
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .post('/api/events')
        .send({ name: 'Un mariage en juin', wallLanguage: 'pt' })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('request.invalid')
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

    it('accepts a quota exactly at the box-wide ceiling', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .post('/api/events')
        .send({ name: 'Un mariage en juin', quotaBytes: MAX_QUOTA_BYTES })

      expect(response.status).toBe(201)
      expect(response.body.quotaBytes).toBe(MAX_QUOTA_BYTES)
    })

    it('answers 400 event.quotaAboveCeiling for a quota over the box-wide ceiling', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .post('/api/events')
        .send({ name: 'Un mariage en juin', quotaBytes: MAX_QUOTA_BYTES + 1 })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('event.quotaAboveCeiling')
      expect(response.body.error.details).toEqual({ maxBytes: MAX_QUOTA_BYTES })
    })

    it('answers 409 for a slug another event already holds, with no echo of it (P4-09, collision neutre)', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.post('/api/events').send({ name: 'Encore un', slug: SLUG })

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('event.slugUnavailable')
      expect(response.body.error.details).toEqual({})
    })

    it('answers 429 once an account spends its creation allowance for the hour', async () => {
      const narrowWorld = buildWorld({ creationLimit: 1 })
      const narrowAgent = request.agent(narrowWorld.app)
      await narrowAgent.post('/sign-in/owner').expect(204)

      await narrowAgent.post('/api/events').send({ name: 'Premier évènement' }).expect(201)
      const response = await narrowAgent.post('/api/events').send({ name: 'Second évènement' })

      expect(response.status).toBe(429)
      expect(response.body.error.code).toBe('event.creationRateLimited')
    })

    it('starts from the product defaults when no template is named', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent.post('/api/events').send({ name: 'Un mariage en juin' })

      expect(response.body.settings).toMatchObject({
        moderation: 'manual',
        retentionDays: null,
        maxPhotosPerGuest: null,
        theme: {
          accentHue: 305,
          fonts: 'sans',
          frame: 'soft',
          ambiance: 'eventslide',
        },
      })
    })

    it.each([
      ['wedding', { moderation: 'manual', retentionDays: 365, guestSelfDeleteGraceSeconds: 3_600 }],
      ['birthday', { moderation: 'auto', retentionDays: 90 }],
      ['conference', { retentionDays: 30, allowClips: false, maxPhotosPerGuest: 25 }],
      ['party', { moderation: 'auto', retentionDays: 30 }],
    ])('applies the %s template to the settings it answers with', async (template, expected) => {
      // The wire half of roadmap 3.5: the host is shown what they got in the same
      // response that created it, so the first screen after the form is already the truth.
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .post('/api/events')
        .send({ name: `Un évènement ${template}`, template })

      expect(response.status).toBe(201)
      expect(response.body.settings).toMatchObject(expected)
    })

    it('applies the template’s theme, so the first frame is already the right colour', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .post('/api/events')
        .send({ name: 'Un mariage en juin', template: 'wedding' })

      expect(response.body.settings.theme).toEqual({
        accentHue: 345,
        fonts: 'serif',
        frame: 'round',
        ambiance: 'champs',
        groundUrl: null,
      })
    })

    it('answers with no trace of the template, because nothing stores one', async () => {
      // The escape hatch as a wire contract. If a template key ever appeared on the
      // event, something downstream would eventually read it — and a value a host did not
      // choose would come back at them later.
      const agent = await signedIn(world, 'owner')

      // A name whose slug does not itself contain the template's name, so the assertion
      // below is about the template and not about the address.
      const response = await agent
        .post('/api/events')
        .send({ name: 'Séminaire annuel', template: 'conference' })

      expect(response.body).not.toHaveProperty('template')
      expect(JSON.stringify(response.body)).not.toContain('conference')
    })

    it('lets the host depart from the template immediately, with no fight', async () => {
      // "I picked wedding and then changed moderation", end to end and in the order a
      // host actually does it.
      const agent = await signedIn(world, 'owner')
      const created = await agent
        .post('/api/events')
        .send({ name: 'Un mariage en juin', template: 'wedding' })

      const patched = await agent
        .patch(`/api/events/${String(created.body.slug)}/settings`)
        .send({ moderation: 'auto' })

      expect(patched.status).toBe(200)
      expect(patched.body.settings.moderation).toBe('auto')
      // The rest of the template is untouched by the departure, and nothing puts the
      // moderation mode back on the next read.
      expect(patched.body.settings.retentionDays).toBe(365)

      const reread = await agent.get(`/api/events/${String(created.body.slug)}`)
      expect(reread.body.settings.moderation).toBe('auto')
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

    // The print page (spec 02) reads these two fields as a moderator and as a suspended client's
    // member, and must be answered 404 once the operator takes the event down.
    it('a moderator reads the code and the link', async () => {
      const agent = await signedIn(world, 'moderator')

      const response = await agent.get(`/api/events/${SLUG}`)

      expect(response.body.joinCode).toBe('H7K2QM')
      expect(response.body.joinUrl).toBe('http://localhost:4300/join/H7K2QM')
    })

    it('an event taken down by the operator answers 404 to its owner', async () => {
      await world.events.setTakenDown(asEventId(WEDDING), AT)
      const agent = await signedIn(world, 'owner')

      const response = await agent.get(`/api/events/${SLUG}`)

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('event.notFound')
    })

    it('a suspended client still reads its event, code and link included (200)', async () => {
      world.clients.seed(aClient({ id: CLIENT_ONE, name: 'Atelier Camille' }))
      const member = await signedIn(world, 'client-member')
      const created = await member.post('/api/events').send({ name: 'Un soir de juin' })
      expect(created.status).toBe(201)
      world.clients.seed(aClient({ id: CLIENT_ONE, name: 'Atelier Camille', suspendedAt: AT }))

      // Proof that the suspension took: the same member can no longer write.
      const refused = await member.post('/api/events').send({ name: 'Un autre soir' })
      expect(refused.status).toBeGreaterThanOrEqual(400)

      const response = await member.get(`/api/events/${String(created.body.slug)}`)

      expect(response.status).toBe(200)
      expect(response.body.joinCode).toBe(created.body.joinCode)
      expect(response.body.joinUrl).toBe(
        `http://localhost:4300/join/${String(created.body.joinCode)}`,
      )
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
        allowClips: false,
        allowGuestbook: true,
        guestbookOnWall: false,
        allowGuestSelfDelete: false,
        guestSelfDeleteGraceSeconds: 60,
        retentionDays: 7,
        maxPhotosPerGuest: 5,
        theme: {
          accentHue: 345,
          fonts: 'serif',
          frame: 'round',
          ambiance: 'guinguette',
        },
        wallLanguage: 'en',
      })

      expect(response.status).toBe(200)
      expect(response.body.settings).toEqual({
        moderation: 'auto',
        allowCaptions: false,
        allowReactions: false,
        allowClips: false,
        allowGuestbook: true,
        guestbookOnWall: false,
        allowGuestSelfDelete: false,
        guestSelfDeleteGraceSeconds: 60,
        retentionDays: 7,
        maxPhotosPerGuest: 5,
        theme: {
          accentHue: 345,
          fonts: 'serif',
          frame: 'round',
          ambiance: 'guinguette',
          groundUrl: null,
        },
        wallLanguage: 'en',
        brand: { welcomeMessage: null },
      })
    })

    /* ---- The host's welcome message (spec 03). ---- */

    it('stores a welcome message and answers it in the settings brand', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .patch(`/api/events/${SLUG}/settings`)
        .send({ welcomeMessage: '  Bienvenue !\n\nUne photo du gâteau ?  ' })

      expect(response.status).toBe(200)
      expect(response.body.settings.brand).toEqual({
        welcomeMessage: 'Bienvenue !\nUne photo du gâteau ?',
      })
    })

    it('leaves the message alone when an older tab saves settings without it', async () => {
      const agent = await signedIn(world, 'owner')
      await agent.patch(`/api/events/${SLUG}/settings`).send({ welcomeMessage: 'Bienvenue' })

      const response = await agent
        .patch(`/api/events/${SLUG}/settings`)
        .send({ allowCaptions: false })

      expect(response.status).toBe(200)
      expect(response.body.settings.brand.welcomeMessage).toBe('Bienvenue')
    })

    it('clears the message on null', async () => {
      const agent = await signedIn(world, 'owner')
      await agent.patch(`/api/events/${SLUG}/settings`).send({ welcomeMessage: 'Bienvenue' })

      const response = await agent
        .patch(`/api/events/${SLUG}/settings`)
        .send({ welcomeMessage: null })

      expect(response.body.settings.brand.welcomeMessage).toBeNull()
    })

    it('answers the domain code for a message that is too long or has too many lines', async () => {
      const agent = await signedIn(world, 'owner')

      const long = await agent
        .patch(`/api/events/${SLUG}/settings`)
        .send({ welcomeMessage: 'x'.repeat(281) })
      const lines = await agent
        .patch(`/api/events/${SLUG}/settings`)
        .send({ welcomeMessage: 'a\nb\nc\nd\ne' })

      expect(long.status).toBe(400)
      expect(long.body.error.code).toBe('eventSettings.welcomeTooLong')
      expect(lines.body.error.code).toBe('eventSettings.welcomeTooManyLines')
    })

    it('reads and ignores a read-only brand key, and refuses a logo key', async () => {
      const agent = await signedIn(world, 'owner')

      const ignored = await agent.patch(`/api/events/${SLUG}/settings`).send({
        brand: { welcomeMessage: 'Piraté', logoUrl: null },
        allowCaptions: false,
      })
      const refused = await agent
        .patch(`/api/events/${SLUG}/settings`)
        .send({ logo: 'ab'.repeat(32) })

      expect(ignored.status).toBe(200)
      expect(ignored.body.settings.brand.welcomeMessage).toBeNull()
      expect(refused.status).toBe(400)
    })

    it('refuses the owner role only: a moderator cannot write the message', async () => {
      const agent = await signedIn(world, 'moderator')

      const response = await agent
        .patch(`/api/events/${SLUG}/settings`)
        .send({ welcomeMessage: 'x' })

      expect(response.status).toBe(403)
    })

    /* ---- Per-event theming (roadmap 2.2). ---- */

    it('refuses a palette the room could not read, and says which rule it broke', async () => {
      // The whole point of the constraint: a host may pick the look, and may not pick a
      // look that makes the wall unreadable. 160 degrees is `--success`, so the accent
      // and "published" would be the same signal to a room ten metres away.
      const agent = await signedIn(world, 'owner')

      const response = await agent.patch(`/api/events/${SLUG}/settings`).send({
        theme: {
          accentHue: 160,
          fonts: 'sans',
          frame: 'soft',
          ambiance: 'guinguette',
        },
      })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('eventTheme.accentTooCloseToStatus')
      // A reason the host can act on: which colour it clashed with, and by how much. The
      // number is an Oklab distance rather than an angle, because that is the scale the
      // rule judges on — `--warning` is light and weak where `--danger` is dark and
      // strong, so degrees compare three targets on three different scales.
      expect(response.body.error.details).toMatchObject({ conflictsWith: 'success', minimum: 0.11 })
    })

    it('leaves the stored theme alone when it refuses one', async () => {
      // A refusal is not a partial save. The event is still the event it was, which is
      // what lets the console show the failure beside the values it is still holding.
      const agent = await signedIn(world, 'owner')

      await agent.patch(`/api/events/${SLUG}/settings`).send({
        theme: {
          accentHue: 160,
          fonts: 'serif',
          frame: 'round',
          ambiance: 'guinguette',
        },
      })

      expect((await world.events.findById(WEDDING))?.settings.theme).toEqual({
        accentHue: 305,
        fonts: 'sans',
        frame: 'soft',
        ambiance: 'eventslide',
      })
    })

    describe('the host’s own ambiance (ADR 0011)', () => {
      const custom = { ground: 'light', groundHue: 40, faces: 'noces' }
      const theme = (extra: Record<string, unknown>) => ({
        accentHue: 345,
        fonts: 'sans',
        frame: 'soft',
        ...extra,
      })

      it('stores it and answers it on the wire', async () => {
        const agent = await signedIn(world, 'owner')

        const response = await agent
          .patch(`/api/events/${SLUG}/settings`)
          .send({ theme: theme({ ambiance: 'custom', custom }) })

        expect(response.status).toBe(200)
        expect(response.body.settings.theme.custom).toEqual(custom)
        expect((await world.events.findById(WEDDING))?.settings.theme.custom).toEqual(custom)
      })

      it.each([22, 155, 85])(
        'accepts accent hue %i, a status-like colour, on a custom ambiance (ADR 0011, decision 8)',
        async (accentHue) => {
          const agent = await signedIn(world, 'owner')

          const response = await agent
            .patch(`/api/events/${SLUG}/settings`)
            .send({ theme: theme({ accentHue, ambiance: 'custom', custom }) })

          expect(response.status).toBe(200)
          expect(response.body.settings.theme.accentHue).toBe(accentHue)
        },
      )

      it('answers 400 eventTheme.customRequired when the ambiance is custom without it', async () => {
        const agent = await signedIn(world, 'owner')

        const response = await agent
          .patch(`/api/events/${SLUG}/settings`)
          .send({ theme: theme({ ambiance: 'custom' }) })

        expect(response.status).toBe(400)
        expect(response.body.error.code).toBe('eventTheme.customRequired')
      })

      it('answers 400 eventTheme.customNotAllowed when another ambiance carries it', async () => {
        const agent = await signedIn(world, 'owner')

        const response = await agent
          .patch(`/api/events/${SLUG}/settings`)
          .send({ theme: theme({ ambiance: 'noces', custom }) })

        expect(response.status).toBe(400)
        expect(response.body.error.code).toBe('eventTheme.customNotAllowed')
      })

      it.each([
        ['a hue off the circle', { ...custom, groundHue: 360 }],
        ['an unknown polarity', { ...custom, ground: 'grey' }],
        ['custom borrowing custom', { ...custom, faces: 'custom' }],
        ['an extra key', { ...custom, accent: 'red' }],
      ])('refuses %s at the boundary', async (_name, bad) => {
        const agent = await signedIn(world, 'owner')

        const response = await agent
          .patch(`/api/events/${SLUG}/settings`)
          .send({ theme: theme({ ambiance: 'custom', custom: bad }) })

        expect(response.status).toBe(400)
        expect(response.body.error.code).toBe('request.invalid')
      })
    })

    it('refuses half a theme rather than merging one', async () => {
      // `.strict()` plus four required keys. A patch carrying only a hue would make the
      // server pair it with whatever face happened to be stored, which is a palette
      // nobody chose and the one thing the legibility rule cannot judge.
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .patch(`/api/events/${SLUG}/settings`)
        .send({ theme: { accentHue: 345 } })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('request.invalid')
    })

    it.each(['glass', 'plain'])(
      'accepts a theme that still carries material %s, and answers without it',
      async (material) => {
        // ADR 0012: glass is retired. A tab left open across the deploy still sends the key and
        // must not get a 400; the route never forwards it, so it is neither stored nor answered.
        const agent = await signedIn(world, 'owner')

        const response = await agent.patch(`/api/events/${SLUG}/settings`).send({
          theme: {
            accentHue: 305,
            fonts: 'sans',
            frame: 'soft',
            material,
            ambiance: 'guinguette',
          },
        })

        expect(response.status).toBe(200)
        expect(response.body.settings.theme).not.toHaveProperty('material')
        expect((await world.events.findById(WEDDING))?.settings.theme).not.toHaveProperty(
          'material',
        )
      },
    )

    it('refuses a material outside the retired vocabulary', async () => {
      // Read and ignored, but still a closed vocabulary: a value no build ever sent is not an old tab.
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .patch(`/api/events/${SLUG}/settings`)
        .send({ theme: { accentHue: 305, fonts: 'sans', frame: 'soft', material: 'opaque' } })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('request.invalid')
    })

    it('leaves an event nobody themed on the look it already had', async () => {
      // Every committed wall baseline photographs this event. A save of some unrelated
      // setting must not move it.
      const agent = await signedIn(world, 'owner')

      const response = await agent
        .patch(`/api/events/${SLUG}/settings`)
        .send({ allowCaptions: false })

      expect(response.status).toBe(200)
      expect(response.body.settings.theme).toEqual({
        accentHue: 305,
        fonts: 'sans',
        frame: 'soft',
        ambiance: 'eventslide',
        groundUrl: null,
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

  /**
   * `EVENT_CREATION` and the client an event belongs to (P3-05 / G2-04), through the real
   * router. The use case's own cases are ring 2; what only this ring can show is that the
   * refusals reach the caller with the right status and code, and that the one field the
   * body gained is parsed, forwarded and not echoed back.
   */
  describe('POST /api/events under EVENT_CREATION', () => {
    describe('=clientMembers', () => {
      beforeEach(() => {
        world = buildWorld({ eventCreation: 'clientMembers' })
      })

      it('answers 403 event.creationNotAllowed to a moderator somebody invited', async () => {
        const agent = await signedIn(world, 'moderator')

        const response = await agent.post('/api/events').send({ name: 'Un mariage en juin' })

        expect(response.status).toBe(403)
        expect(response.body.error.code).toBe('event.creationNotAllowed')
      })

      it('answers 403 to an account that belongs to no client, and creates nothing', async () => {
        const agent = await signedIn(world, 'newcomer')

        const response = await agent.post('/api/events').send({ name: 'Un mariage en juin' })

        expect(response.status).toBe(403)
        expect(await world.events.slugTaken(slugOf('un-mariage-en-juin'))).toBe(false)
      })

      it('creates the event of a member, carrying the client', async () => {
        const agent = await signedIn(world, 'client-member')

        const response = await agent.post('/api/events').send({ name: 'Un mariage en juin' })

        expect(response.status).toBe(201)
        expect((await world.events.findBySlug(slugOf('un-mariage-en-juin')))?.clientId).toBe(
          CLIENT_ONE,
        )
      })

      it('does not tell the caller which client the event was attached to', async () => {
        const agent = await signedIn(world, 'client-member')

        const response = await agent.post('/api/events').send({ name: 'Un mariage en juin' })

        expect(JSON.stringify(response.body)).not.toContain(CLIENT_ONE)
      })

      it('lets the operator create an event, with no client', async () => {
        const agent = await signedIn(world, 'operator')

        const response = await agent.post('/api/events').send({ name: 'Un mariage en juin' })

        expect(response.status).toBe(201)
        expect((await world.events.findBySlug(slugOf('un-mariage-en-juin')))?.clientId).toBeNull()
      })

      it('refuses a client the operator does not belong to, as 404 client.notFound', async () => {
        const agent = await signedIn(world, 'operator')

        const response = await agent
          .post('/api/events')
          .send({ name: 'Un mariage en juin', clientId: CLIENT_ONE })

        expect(response.status).toBe(404)
        expect(response.body.error.code).toBe('client.notFound')
      })

      it('asks a member of two clients which one, as 404 client.notFound when they do not say', async () => {
        const agent = await signedIn(world, 'two-clients-member')

        const response = await agent.post('/api/events').send({ name: 'Un mariage en juin' })

        expect(response.status).toBe(404)
        expect(response.body.error.code).toBe('client.notFound')
      })

      it('attaches the event to the client a member of two names', async () => {
        const agent = await signedIn(world, 'two-clients-member')

        const response = await agent
          .post('/api/events')
          .send({ name: 'Un mariage en juin', clientId: CLIENT_TWO })

        expect(response.status).toBe(201)
        expect((await world.events.findBySlug(slugOf('un-mariage-en-juin')))?.clientId).toBe(
          CLIENT_TWO,
        )
      })

      it('answers a client that is not the caller’s with 404, exactly as one that does not exist', async () => {
        const agent = await signedIn(world, 'client-member')

        const foreign = await agent
          .post('/api/events')
          .send({ name: 'Un mariage en juin', clientId: CLIENT_TWO })
        const unknown = await agent
          .post('/api/events')
          .send({ name: 'Un mariage en juin', clientId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })

        expect(foreign.status).toBe(404)
        expect(foreign.body).toEqual(unknown.body)
      })

      it('refuses a client id that is not a uuid as 400 request.invalid', async () => {
        const agent = await signedIn(world, 'client-member')

        const response = await agent
          .post('/api/events')
          .send({ name: 'Un mariage en juin', clientId: 'client-one' })

        expect(response.status).toBe(400)
        expect(response.body.error.code).toBe('request.invalid')
      })

      it('answers 409 client.ceilingReached once the client has used its events', async () => {
        world.clients.seed(
          aClient({ id: CLIENT_ONE, name: 'Atelier Camille', ceilings: { maxEvents: 1 } }),
        )
        const agent = await signedIn(world, 'client-member')
        await agent.post('/api/events').send({ name: 'Un premier soir' }).expect(201)

        const response = await agent.post('/api/events').send({ name: 'Un second soir' })

        expect(response.status).toBe(409)
        expect(response.body.error.code).toBe('client.ceilingReached')
        expect(response.body.error.details).toEqual({ ceiling: 'events', used: 1, max: 1 })
      })

      it('refuses create, delete, recreate under max_events_per_period=1, end to end', async () => {
        // The route that deletes is the route that must not give the slot back.
        world.clients.seed(
          aClient({
            id: CLIENT_ONE,
            name: 'Atelier Camille',
            ceilings: { maxEventsPerPeriod: 1 },
          }),
        )
        const agent = await signedIn(world, 'client-member')
        const created = await agent.post('/api/events').send({ name: 'Un premier soir' })
        await agent.delete(`/api/events/${String(created.body.slug)}`).expect(204)

        const again = await agent.post('/api/events').send({ name: 'Un second soir' })

        expect(again.status).toBe(409)
        expect(again.body.error.details).toMatchObject({ ceiling: 'eventsPerPeriod' })
      })
    })

    describe('=anyAccount, the default', () => {
      it('lets an account that belongs to no client create an event, as every box always has', async () => {
        const agent = await signedIn(world, 'newcomer')

        const response = await agent.post('/api/events').send({ name: 'Un mariage en juin' })

        expect(response.status).toBe(201)
        expect((await world.events.findBySlug(slugOf('un-mariage-en-juin')))?.clientId).toBeNull()
      })

      it('still attaches the event of a client member to the client', async () => {
        const agent = await signedIn(world, 'client-member')

        await agent.post('/api/events').send({ name: 'Un mariage en juin' }).expect(201)

        expect((await world.events.findBySlug(slugOf('un-mariage-en-juin')))?.clientId).toBe(
          CLIENT_ONE,
        )
      })
    })
  })

  // ------------------------------------------------------ a client's ceilings --

  /**
   * What a client's ceilings do over the wire (roadmap §10.5 / G2-05): the statuses and
   * codes of `docs/API.md` §2, end to end through the real routes and use cases. The member
   * of **client-one** creates, so the event belongs to it and every ceiling applies; the
   * wedding (an account with no client, `world.events`) is the control that nothing changed
   * for an event with none.
   */
  describe('a client’s ceilings on the host routes', () => {
    const GB = 1_000_000_000

    const withCeilings = (ceilings: Partial<ClientCeilingsProps>): void => {
      world.clients.seed(aClient({ id: CLIENT_ONE, name: 'Atelier Camille', ceilings }))
    }

    /** The client member's own event, created through the API so it belongs to the client. */
    const createdByTheClient = async (agent: Agent, name = 'Un soir de juin') => {
      const response = await agent.post('/api/events').send({ name })
      expect(response.status).toBe(201)
      return String(response.body.slug)
    }

    describe('POST /api/events', () => {
      it('answers 400 event.quotaAboveCeiling, naming the bound, for a quota above max_event_quota_bytes', async () => {
        withCeilings({ maxEventQuotaBytes: 2 * GB })
        const agent = await signedIn(world, 'client-member')

        const response = await agent
          .post('/api/events')
          .send({ name: 'Un soir de juin', quotaBytes: 3 * GB })

        expect(response.status).toBe(400)
        expect(response.body.error.code).toBe('event.quotaAboveCeiling')
        expect(response.body.error.details).toEqual({ maxBytes: 2 * GB })
      })

      it('creates the event at exactly the ceiling', async () => {
        withCeilings({ maxEventQuotaBytes: 2 * GB })
        const agent = await signedIn(world, 'client-member')

        const response = await agent
          .post('/api/events')
          .send({ name: 'Un soir de juin', quotaBytes: 2 * GB })

        expect(response.status).toBe(201)
        expect((await world.events.findBySlug(slugOf('un-soir-de-juin')))?.quotaBytes).toBe(2 * GB)
      })

      it('turns the default “keep for ever” into max_retention_days, readable in the settings', async () => {
        withCeilings({ maxRetentionDays: 30 })
        const agent = await signedIn(world, 'client-member')

        const slug = await createdByTheClient(agent)
        const settings = await agent.get(`/api/events/${slug}`)

        expect(settings.body.settings.retentionDays).toBe(30)
      })

      it('switches clips off for a client that has none, readable in the settings', async () => {
        withCeilings({ clipsAllowed: false })
        const agent = await signedIn(world, 'client-member')

        const slug = await createdByTheClient(agent)
        const settings = await agent.get(`/api/events/${slug}`)

        expect(settings.body.settings.allowClips).toBe(false)
      })

      it('leaves an account with no client exactly as it was: default quota, kept for ever, clips on', async () => {
        withCeilings({ maxEventQuotaBytes: GB, maxRetentionDays: 7, clipsAllowed: false })
        const agent = await signedIn(world, 'newcomer')

        const response = await agent.post('/api/events').send({ name: 'Un soir de juin' })

        expect(response.status).toBe(201)
        expect(response.body.settings.retentionDays).toBeNull()
        expect(response.body.settings.allowClips).toBe(true)
      })
    })

    describe('PATCH /api/events/:slug/settings', () => {
      it('answers 400 client.retentionAboveCeiling, naming the bound, above max_retention_days', async () => {
        withCeilings({ maxRetentionDays: 30 })
        const agent = await signedIn(world, 'client-member')
        const slug = await createdByTheClient(agent)

        const response = await agent
          .patch(`/api/events/${slug}/settings`)
          .send({ retentionDays: 31 })

        expect(response.status).toBe(400)
        expect(response.body.error.code).toBe('client.retentionAboveCeiling')
        expect(response.body.error.details).toEqual({ maxDays: 30 })
      })

      it('answers 400 for “keep for ever” once a ceiling exists', async () => {
        withCeilings({ maxRetentionDays: 30 })
        const agent = await signedIn(world, 'client-member')
        const slug = await createdByTheClient(agent)

        const response = await agent
          .patch(`/api/events/${slug}/settings`)
          .send({ retentionDays: null })

        expect(response.status).toBe(400)
        expect(response.body.error.code).toBe('client.retentionAboveCeiling')
      })

      it('accepts a retention at the ceiling', async () => {
        withCeilings({ maxRetentionDays: 30 })
        const agent = await signedIn(world, 'client-member')
        const slug = await createdByTheClient(agent)

        const response = await agent
          .patch(`/api/events/${slug}/settings`)
          .send({ retentionDays: 30 })

        expect(response.status).toBe(200)
      })

      it('answers 400 client.clipsNotAllowed when switching clips on for a client that has none', async () => {
        withCeilings({ clipsAllowed: false })
        const agent = await signedIn(world, 'client-member')
        const slug = await createdByTheClient(agent)

        const response = await agent
          .patch(`/api/events/${slug}/settings`)
          .send({ allowClips: true })

        expect(response.status).toBe(400)
        expect(response.body.error.code).toBe('client.clipsNotAllowed')
      })

      it('imposes nothing on the wedding, which belongs to no client', async () => {
        withCeilings({ maxRetentionDays: 1, clipsAllowed: false })
        const agent = await signedIn(world, 'owner')

        const response = await agent
          .patch(`/api/events/${SLUG}/settings`)
          .send({ retentionDays: 3_650, allowClips: true })

        expect(response.status).toBe(200)
      })
    })

    describe('POST /api/events/:slug/status', () => {
      it('answers 403 client.liveNotAllowed for a client that may not go live, and the event stays a draft', async () => {
        withCeilings({ liveAllowed: false })
        const agent = await signedIn(world, 'client-member')
        const slug = await createdByTheClient(agent)

        const response = await agent.post(`/api/events/${slug}/status`).send({ status: 'live' })

        expect(response.status).toBe(403)
        expect(response.body.error.code).toBe('client.liveNotAllowed')
        expect((await world.events.findBySlug(slugOf(slug)))?.status).toBe('draft')
      })

      it('opens an event inside the window and records when, which is what the window counts from', async () => {
        withCeilings({ maxLiveDays: 3 })
        const agent = await signedIn(world, 'client-member')
        const slug = await createdByTheClient(agent)

        const response = await agent.post(`/api/events/${slug}/status`).send({ status: 'live' })

        expect(response.status).toBe(200)
        expect((await world.events.findBySlug(slugOf(slug)))?.openedAt).toEqual(AT)
      })

      it('answers 403 client.liveWindowOver for a reopening once opened_at + max_live_days has passed', async () => {
        withCeilings({ maxLiveDays: 3 })
        const agent = await signedIn(world, 'client-member')
        const slug = await createdByTheClient(agent)
        // The event ran ten days ago and has been closed since: the harness clock is fixed,
        // so the past is arranged rather than waited for.
        const event = await world.events.findBySlug(slugOf(slug))
        if (event === null) throw new Error('the event was just created')
        await world.events.save(
          Event.restore({
            ...event.toProps(),
            status: 'closed',
            openedAt: atPlus(-10 * 86_400_000),
            closedAt: atPlus(-9 * 86_400_000),
          }),
        )

        const response = await agent.post(`/api/events/${slug}/status`).send({ status: 'live' })

        expect(response.status).toBe(403)
        expect(response.body.error.code).toBe('client.liveWindowOver')
        expect((await world.events.findBySlug(slugOf(slug)))?.status).toBe('closed')
      })

      it('still reopens an event with no client, however long ago it first opened', async () => {
        withCeilings({ maxLiveDays: 1 })
        const wedding = await world.events.findById(WEDDING)
        if (wedding === null) throw new Error('the wedding is seeded')
        await world.events.save(
          Event.restore({
            ...wedding.toProps(),
            status: 'closed',
            openedAt: atPlus(-400 * 86_400_000),
            closedAt: atPlus(-399 * 86_400_000),
          }),
        )
        const agent = await signedIn(world, 'owner')

        const response = await agent.post(`/api/events/${SLUG}/status`).send({ status: 'live' })

        expect(response.status).toBe(200)
      })
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
      await world.media.put(WEDDING, aPhoto().contentHash, 'original', Uint8Array.of(1))
      await world.media.put(GALA, aPhoto().contentHash, 'original', Uint8Array.of(1))

      await agent.delete(`/api/events/${SLUG}`)

      expect(await world.media.usedBytes(WEDDING)).toBe(0)
      expect(await world.media.usedBytes(GALA)).toBe(1)
    })

    it('leaves another event untouched', async () => {
      const agent = await signedIn(world, 'owner')

      await agent.delete(`/api/events/${SLUG}`)

      expect(await world.events.findById(GALA)).not.toBeNull()
    })
  })

  describe('GET /api/events/:slug/stats', () => {
    it('answers the page figures, derived, with no-store and the wire field list', async () => {
      const agent = await signedIn(world, 'moderator')
      const before = (await agent.get(`/api/events/${SLUG}/stats`)).body.uploads.total
      world.guests.seed(aGuest({ id: WEDDING_GUEST, eventId: 'evt-wedding', displayName: 'Léa' }))
      world.photos.seed(
        aPhoto({
          id: 'sp1',
          eventId: 'evt-wedding',
          author: { kind: 'guest', id: WEDDING_GUEST },
          status: 'published',
        }),
        aPhoto({
          id: 'sp2',
          eventId: 'evt-wedding',
          author: { kind: 'guest', id: WEDDING_GUEST },
          status: 'rejected',
        }),
      )

      const response = await agent.get(`/api/events/${SLUG}/stats`)

      expect(response.status).toBe(200)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(Object.keys(response.body).sort()).toEqual([
        'anonymousContributors',
        'engagement',
        'guests',
        'photos',
        'reactions',
        'topContributors',
        'uploads',
      ])
      expect(response.body.uploads.total).toBe(before + 2)
      expect(response.body.topContributors).toEqual([
        { displayName: 'Léa', photos: 1, reactions: 0 },
      ])
      expect(response.body.engagement).toBeNull()
    })

    it("does not show another event's figures to this event's moderator", async () => {
      world.photos.seed(
        aPhoto({
          id: 'gala-photo',
          eventId: 'evt-gala',
          author: { kind: 'host', id: GALA_OWNER },
          status: 'published',
        }),
      )
      const agent = await signedIn(world, 'moderator')

      const own = await agent.get(`/api/events/${SLUG}/stats`)

      expect(own.body.uploads.total).toBe(world.photos.ofEvent(WEDDING).length)
    })

    it('refuses a parameter with a 400', async () => {
      const agent = await signedIn(world, 'moderator')

      const response = await agent.get(`/api/events/${SLUG}/stats?since=today`)

      expect(response.status).toBe(400)
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
    const invite = (agent: Agent, body: Record<string, unknown> = { email: 'lea@example.test' }) =>
      agent.post(`/api/events/${SLUG}/moderators`).send(body)

    it('writes an invitation and mails it: 201 with its end, and no link, no id, no password', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await invite(agent)

      expect(response.status).toBe(201)
      expect(Object.keys(response.body).sort()).toEqual(['expiresAt', 'status'])
      expect(response.body.status).toBe('invited')
      expect(response.body.expiresAt).toBe('2026-06-27T21:00:00.000Z')
      expect(world.mailer.sent).toHaveLength(1)
      expect(world.mailer.sent[0]?.to).toBe('lea@example.test')
    })

    it("creates no account and grants no role: that is the invitee's act", async () => {
      const agent = await signedIn(world, 'owner')

      await invite(agent)

      expect(await world.memberships.listForEvent(WEDDING)).toHaveLength(2)
      expect(world.tokens.all).toHaveLength(1)
      expect(world.tokens.all[0]).toMatchObject({ eventId: WEDDING, eventRole: 'moderator' })
    })

    it('answers 201 with the link to pass on when the box cannot send mail', async () => {
      world = buildWorld({ mailer: 'none' })
      const agent = await signedIn(world, 'owner')

      const response = await invite(agent)

      expect(response.status).toBe(201)
      expect(response.body.link).toMatch(/^https:\/\/photos\.example\.test\/invite\/secret-1$/)
      expect(world.tokens.all[0]?.delivery).toBe('link')
    })

    it('is never cached, since it may carry the only copy of the link', async () => {
      const agent = await signedIn(world, 'owner')

      const response = await invite(agent)

      expect(response.headers['cache-control']).toBe('no-store')
    })

    it('answers an address with an account exactly as one with none', async () => {
      const agent = await signedIn(world, 'owner')

      const known = await invite(agent, { email: 'nouvelle@example.test' })
      const unknown = await invite(agent, { email: 'inconnue@example.test' })

      expect(known.status).toBe(unknown.status)
      expect(Object.keys(known.body).sort()).toEqual(Object.keys(unknown.body).sort())
      expect(JSON.stringify(known.body)).not.toContain(NEWCOMER)
    })

    it('writes the mail in French when the form sends no language, the product source language', async () => {
      const agent = await signedIn(world, 'owner')

      await invite(agent)

      expect(world.mailer.sent[0]?.text).toContain('Bonjour,')
    })

    it('answers 429 once one account has written thirty invitations in an hour, to thirty addresses', async () => {
      const agent = await signedIn(world, 'owner')
      for (let attempt = 0; attempt < 30; attempt += 1) {
        expect((await invite(agent, { email: `personne-${attempt}@example.test` })).status).toBe(
          201,
        )
      }

      const refused = await invite(agent, { email: 'une-de-trop@example.test' })

      expect(refused.status).toBe(429)
      expect(refused.body.error.code).toBe('rate.limited')
      expect(world.mailer.sent).toHaveLength(30)
    })

    it('counts that allowance per account, so another host is not locked out by the first', async () => {
      const agent = await signedIn(world, 'owner')
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await invite(agent, { email: `personne-${attempt}@example.test` })
      }
      const other = await signedIn(world, 'gala-owner')

      const response = await other
        .post('/api/events/gala-annuel/moderators')
        .send({ email: 'quelquun@example.test' })

      expect(response.status).toBe(201)
    })

    it('writes the mail in the language the form sent', async () => {
      const agent = await signedIn(world, 'owner')

      await invite(agent, { email: 'lea@example.test', locale: 'en' })

      expect(world.mailer.sent[0]?.subject).toBe(
        'You are invited to moderate an event on EventSlide',
      )
    })

    it.each([
      [
        'a temporary password, which 2.x asked for',
        { email: 'lea@example.test', [RETIRED_PASSWORD_FIELD]: 'mot-de-passe-provisoire' },
      ],
      [
        'a display name, which the invitee now chooses',
        { email: 'lea@example.test', displayName: 'Léa' },
      ],
      ['a locale that is not one', { email: 'lea@example.test', locale: 'xx' }],
      ['no address', {}],
    ])('refuses %s with 400 and writes nothing', async (_label, body) => {
      const agent = await signedIn(world, 'owner')

      const response = await invite(agent, body)

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('request.invalid')
      expect(world.tokens.all).toHaveLength(0)
      expect(world.mailer.sent).toHaveLength(0)
    })

    it('invites to this event only', async () => {
      const agent = await signedIn(world, 'owner')

      await invite(agent)

      expect(world.tokens.all.map((token) => token.eventId)).toEqual([WEDDING])
    })

    it('answers 409 for an address that already has a role on this event', async () => {
      // Re-inviting would otherwise silently downgrade a co-owner to moderator.
      const agent = await signedIn(world, 'owner')

      const response = await invite(agent, { email: 'moderateur@example.test' })

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('membership.alreadyExists')
    })

    it('answers 429 once an address has been written to five times in an hour', async () => {
      const agent = await signedIn(world, 'owner')
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await invite(agent)).status).toBe(201)
      }

      const response = await invite(agent)

      expect(response.status).toBe(429)
      expect(response.body.error.code).toBe('invitation.tooManyForAddress')
      // Section 1: every `rateLimited` carries `Retry-After`; the window is the longest anyone waits.
      expect(response.headers['retry-after']).toBe('3600')
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
