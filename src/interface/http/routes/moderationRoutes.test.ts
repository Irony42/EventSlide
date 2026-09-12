import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { moderationRoutes, withModerator } from './moderationRoutes'
import { buildHarness, signInAs, type Harness } from '../testing/middlewareHarness'
import { GUEST_COOKIE, resolvePublicEvent } from '../middleware/authz'
import type { PresenterContext } from '../presenters/presenters'
import { sendNoContent } from '../presenters/send'
import type { HttpDeps } from '../types'
import type { HttpUseCases } from '../useCases'
import type { MediaMetadata, MediaStore } from '../../../application/ports/mediaStore'
import {
  AT,
  aGuest,
  anEvent,
  aPhoto,
  aReaction,
  atPlus,
} from '../../../application/testing/builders'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { FakeReactionRepository } from '../../../application/testing/fakeReactionRepository'
import { makeGetModerationQueue } from '../../../application/usecases/moderation/getModerationQueue'
import { makeModeratePhoto } from '../../../application/usecases/moderation/moderatePhoto'
import { makeModeratePhotosBulk } from '../../../application/usecases/moderation/moderatePhotosBulk'
import { makeDeletePhoto } from '../../../application/usecases/photos/deletePhoto'
import { makeListEventPhotos } from '../../../application/usecases/photos/listEventPhotos'
import { makeGetTopPhotos } from '../../../application/usecases/reactions/getTopPhotos'
import type { ContentHash } from '../../../domain/photos/contentHash'
import { DomainError } from '../../../domain/shared/errors'
import { asEventId, asPhotoId, asUserId, type EventId } from '../../../domain/shared/ids'
import { err } from '../../../domain/shared/result'

/**
 * Ring 4: the wire contract and the authorization decision for the host's console.
 *
 * The use cases here are the **real** ones, built over the in-memory fakes rather than
 * stubbed. That is what makes the cross-event cases mean something: `FakePhotoRepository`
 * keys rows by `${eventId}:${photoId}`, so a wedding moderator naming a gala photo id
 * genuinely misses, exactly as the SQLite adapter's scoped query does. A stub returning
 * whatever the test told it to would let every one of these assertions pass while the
 * product leaked.
 */

const WEDDING = 'wedding-id'
const GALA = 'gala-id'
const OWNER = 'owner-id'
const MODERATOR = 'moderator-id'
const GALA_OWNER = 'gala-owner-id'
const GUEST = 'guest-1'

/** Real UUIDs, because `photoParams` parses `:photoId` as one. */
const P = {
  olderPending: '11111111-1111-4111-8111-111111111111',
  pending: '22222222-2222-4222-8222-222222222222',
  published: '33333333-3333-4333-8333-333333333333',
  rejected: '44444444-4444-4444-8444-444444444444',
  hidden: '55555555-5555-4555-8555-555555555555',
  publishedTwo: '66666666-6666-4666-8666-666666666666',
  gala: '77777777-7777-4777-8777-777777777777',
} as const

const PRESENTER: PresenterContext = {
  publicUrl: 'http://localhost:4300',
  uploadLimits: { maxBytes: 25_000_000, maxFiles: 20 },
}

/**
 * Only `delete` matters to a moderator removing a photo; the read paths belong to
 * `mediaRoutes`. Recording the deletion is what proves the file went before the row —
 * the row is the only record of the file's address, so the other order strands bytes
 * nobody can name.
 */
class RecordingMediaStore implements MediaStore {
  readonly deleted: string[] = []

  async put(): Promise<void> {}

  async exists(): Promise<boolean> {
    return false
  }

  async stat(): Promise<MediaMetadata | null> {
    return null
  }

  async openRead(): Promise<AsyncIterable<Uint8Array> | null> {
    return null
  }

  async read(): Promise<Uint8Array | null> {
    return null
  }

  async delete(eventId: EventId, hash: ContentHash): Promise<void> {
    this.deleted.push(`${eventId}|${hash.value}`)
  }

  async deleteEvent(): Promise<void> {}

  async usedBytes(): Promise<number> {
    return 0
  }
}

interface Adapters {
  readonly photos: FakePhotoRepository
  readonly reactions: FakeReactionRepository
  readonly media: RecordingMediaStore
}

/**
 * Every use case this module never calls, wired to a loud failure.
 *
 * Not an empty success: if a refactor ever pointed one of these routes at the wrong
 * use case, "no photos and a 200" would read as a passing test.
 */
const notWired = async () => err(DomainError.unexpected('test.useCaseNotWired'))

/**
 * The use-case bag the router is handed.
 *
 * Built here rather than in the shared harness because five sibling route modules are
 * using that harness, and each needs a different half of this list to be real.
 */
const usecasesFor = (deps: HttpDeps, { photos, reactions, media }: Adapters): HttpUseCases => {
  const { events, guests, memberships, bus, clock } = deps
  return {
    authenticateUser: notWired,
    changePassword: notWired,
    registerModerator: notWired,
    createEvent: notWired,
    getEventBySlug: notWired,
    listEventsForHost: notWired,
    resolveJoinCode: notWired,
    updateEventSettings: notWired,
    rotateJoinCode: notWired,
    changeEventStatus: notWired,
    scheduleEvent: notWired,
    purgeEvent: notWired,
    joinEvent: notWired,
    authenticateGuest: notWired,
    renameGuest: notWired,
    revokeGuest: notWired,
    listGuests: notWired,
    uploadPhotos: notWired,
    listEventPhotos: makeListEventPhotos({ events, photos }),
    listGuestPhotos: notWired,
    deletePhoto: makeDeletePhoto({ events, photos, media, bus, clock }),
    setPhotoCaption: notWired,
    getPhotoMedia: notWired,
    uploadClip: notWired,
    getClipJob: notWired,
    exportAlbum: notWired,
    getModerationQueue: makeGetModerationQueue({ events, photos, guests, memberships }),
    moderatePhoto: makeModeratePhoto({ events, photos, memberships, bus, clock }),
    moderatePhotosBulk: makeModeratePhotosBulk({ events, photos, memberships, bus, clock }),
    getWallPlaylist: notWired,
    reactToPhoto: notWired,
    withdrawReaction: notWired,
    getPhotoReactions: notWired,
    getTopPhotos: makeGetTopPhotos({ photos, reactions }),
  }
}

type World = Harness & Adapters

/**
 * Two events on one box, so every route can be asked the cross-event question.
 *
 * The wedding's happy path runs as a **moderator**, not as the owner: `requireRole`
 * must grant the evening's borrowed laptop exactly this much and no more.
 */
const world = (): World => {
  const photos = new FakePhotoRepository()
  const reactions = new FakeReactionRepository()
  const media = new RecordingMediaStore()
  const adapters: Adapters = { photos, reactions, media }

  const harness = buildHarness({
    routes: (app, deps) => {
      app.post('/sign-in/owner', signInAs({ userId: OWNER, email: 'hote@example.test' }))
      app.post(
        '/sign-in/moderator',
        signInAs({ userId: MODERATOR, email: 'moderateur@example.test' }),
      )
      app.post('/sign-in/gala', signInAs({ userId: GALA_OWNER, email: 'gala@example.test' }))
      app.use(
        '/api',
        moderationRoutes({ deps, usecases: usecasesFor(deps, adapters), presenter: PRESENTER }),
      )
    },
  })

  harness.events.seed(
    anEvent({ id: WEDDING, slug: 'mariage', name: 'Camille & Sacha', ownerId: OWNER }),
    anEvent({ id: GALA, slug: 'gala', name: 'Gala', ownerId: GALA_OWNER, joinCode: 'B4N9PT' }),
  )
  harness.memberships.seed(
    { eventId: asEventId(WEDDING), userId: asUserId(OWNER), role: 'owner', grantedAt: AT },
    { eventId: asEventId(WEDDING), userId: asUserId(MODERATOR), role: 'moderator', grantedAt: AT },
    { eventId: asEventId(GALA), userId: asUserId(GALA_OWNER), role: 'owner', grantedAt: AT },
  )
  // Every wedding photo below is `aPhoto`'s default sender, so the console's rows have
  // a name to carry. A row is what the host judges a photo by: who sent it, and the
  // caption that would go on the wall with it.
  harness.guests.seed(aGuest({ id: GUEST, eventId: WEDDING, displayName: 'Léa' }))
  photos.seed(
    aPhoto({
      id: P.olderPending,
      eventId: WEDDING,
      status: 'pending',
      createdAt: AT,
      caption: 'Les confettis',
    }),
    aPhoto({ id: P.pending, eventId: WEDDING, status: 'pending', createdAt: atPlus(1_000) }),
    aPhoto({ id: P.published, eventId: WEDDING, status: 'published', createdAt: atPlus(2_000) }),
    aPhoto({ id: P.rejected, eventId: WEDDING, status: 'rejected', createdAt: atPlus(3_000) }),
    aPhoto({ id: P.hidden, eventId: WEDDING, status: 'hidden', createdAt: atPlus(4_000) }),
    aPhoto({ id: P.publishedTwo, eventId: WEDDING, status: 'published', createdAt: atPlus(5_000) }),
    aPhoto({ id: P.gala, eventId: GALA, status: 'pending', createdAt: AT }),
  )

  return { ...harness, photos, reactions, media }
}

/** A supertest agent holding the session cookie across requests. */
const signedIn = async (subject: World, who: 'owner' | 'moderator' | 'gala') => {
  const agent = request.agent(subject.app)
  await agent.post(`/sign-in/${who}`).expect(204)
  return agent
}

/** A correctly signed guest device token for the wedding. */
const guestCookie = (subject: World): string =>
  `${GUEST_COOKIE}=${subject.issueGuestToken(WEDDING, GUEST)}`

const statusOf = async (subject: World, photoId: string): Promise<string | null> => {
  const photo = await subject.photos.findById(asEventId(WEDDING), asPhotoId(photoId))
  return photo === null ? null : photo.status
}

let subject: World

beforeEach(() => {
  subject = world()
})

describe('GET /api/events/:eventSlug/moderation', () => {
  it('returns the pending queue oldest first, so the guest by the projector is not starved', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/moderation')

    expect(response.status).toBe(200)
    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([
      P.olderPending,
      P.pending,
    ])
  })

  it('counts the pending photos across the whole event, not the page in hand', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/moderation?limit=1')

    expect(response.body.items).toHaveLength(1)
    expect(response.body.pendingCount).toBe(2)
  })

  it('reports no cursor even when the limit left photos behind', async () => {
    // The queue is ordered in full before the limit applies, so there is no page to
    // continue from. `null` rather than an absent key, so the client reads one shape.
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/moderation?limit=1')

    expect(response.body.nextCursor).toBeNull()
  })

  it('presents exactly the row the console renders: media links, caption, sender, size', async () => {
    // `toEqual` on the whole object, deliberately: a missing field and an extra one are
    // both contract breaks. The console rendered "par undefined" and "undefined ×
    // undefined pixels" for a release because this assertion described a thinner row
    // than the card did, and nothing compared the two.
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/moderation')

    expect(response.body.items[0]).toEqual({
      id: P.olderPending,
      status: 'pending',
      thumbUrl: `/api/events/mariage/photos/${P.olderPending}/thumb`,
      displayUrl: `/api/events/mariage/photos/${P.olderPending}/display`,
      width: 4032,
      height: 3024,
      caption: 'Les confettis',
      authorName: 'Léa',
      createdAt: AT.toISOString(),
      // The clip facet, on a row a host is about to decide about. `videoUrl` is what
      // lets the console play a clip instead of judging it from a still frame.
      kind: 'photo',
      videoUrl: null,
      durationMs: null,
    })
  })

  it('carries the caption text itself, because the host reads it before publishing it', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/moderation')

    expect(response.body.items.map((item: { caption: string | null }) => item.caption)).toEqual([
      'Les confettis',
      null,
    ])
  })

  it('leaves the sender null for a guest who stayed anonymous, rather than inventing a name', async () => {
    // The French for an unattributed photo is the client's ("Invité anonyme"). A server
    // that chose it here would have two clients disagreeing about the wording.
    subject.guests.seed(aGuest({ id: GUEST, eventId: WEDDING, displayName: null }))
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/moderation')

    expect(
      response.body.items.map((item: { authorName: string | null }) => item.authorName),
    ).toEqual([null, null])
  })

  it('never says where a photo is stored, even to a moderator', async () => {
    // A moderation row may say more than a wall item — a moderator is not the room —
    // but a storage key, a content hash or a path is nobody's business on the wire.
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/moderation')

    for (const leak of ['contentHash', 'storageKey', 'path', 'byteSize', 'eventId']) {
      expect(response.body.items[0]).not.toHaveProperty(leak)
    }
  })

  it('serves the album view when asked for every status, newest first', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/moderation?status=all')

    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([
      P.publishedTwo,
      P.hidden,
      P.rejected,
      P.published,
      P.pending,
      P.olderPending,
    ])
  })

  it('is never stored, because this is the one screen showing unapproved photos', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/moderation')

    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('answers 401 without a session', async () => {
    const response = await request(subject.app).get('/api/events/mariage/moderation')

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('answers 404 for a host of another event, never 403', async () => {
    // A 403 would confirm the wedding exists and turn this into an enumeration oracle
    // for other people's events.
    const agent = await signedIn(subject, 'gala')

    const response = await agent.get('/api/events/mariage/moderation')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })

  it('refuses a guest device token, which establishes no user principal', async () => {
    const response = await request(subject.app)
      .get('/api/events/mariage/moderation')
      .set('Cookie', guestCookie(subject))

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it.each([
    { label: 'a status outside the enum', query: 'status=deleted-forever' },
    { label: 'a page size of zero', query: 'limit=0' },
    { label: 'a page size that is not a number', query: 'limit=beaucoup' },
    { label: 'a page size past the cap', query: 'limit=5000' },
    { label: 'an unexpected key', query: 'order=newestFirst' },
    // The parameter this endpoint accepted and never read. The queue reports
    // `nextCursor: null` by design, so a caller holding a cursor was resuming nothing —
    // and got the first page back with no sign that their token had been discarded.
    { label: 'the cursor this queue has never been able to use', query: 'cursor=photo-2' },
    { label: 'a cursor next to parameters it does accept', query: 'status=all&cursor=photo-2' },
  ])('answers 400 for $label', async ({ query }) => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get(`/api/events/mariage/moderation?${query}`)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })
})

describe('GET /api/events/:eventSlug/photos', () => {
  it('lists every status newest first for the admin gallery', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/photos')

    expect(response.status).toBe(200)
    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([
      P.publishedTwo,
      P.hidden,
      P.rejected,
      P.published,
      P.pending,
      P.olderPending,
    ])
  })

  it('filters by status', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/photos?status=published')

    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([
      P.publishedTwo,
      P.published,
    ])
  })

  it('pages by cursor, so a photo arriving mid-scroll cannot shift a row off the page', async () => {
    const agent = await signedIn(subject, 'moderator')

    const first = await agent.get('/api/events/mariage/photos?limit=1')
    expect(first.body.nextCursor).toEqual(expect.any(String))

    const second = await agent.get(
      `/api/events/mariage/photos?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    )

    expect(second.body.items.map((item: { id: string }) => item.id)).toEqual([P.hidden])
  })

  it('presents a photo without its author name rather than inventing French copy', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/photos?status=pending&limit=1')

    expect(response.body.items[0]).toEqual({
      id: P.pending,
      status: 'pending',
      thumbUrl: `/api/events/mariage/photos/${P.pending}/thumb`,
      displayUrl: `/api/events/mariage/photos/${P.pending}/display`,
      width: 4032,
      height: 3024,
      caption: null,
      authorName: null,
      byteSize: 2_400_000,
      createdAt: atPlus(1_000).toISOString(),
      kind: 'photo',
      videoUrl: null,
      durationMs: null,
    })
  })

  it('never returns another event photo through this event path', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/photos')

    expect(response.body.items.map((item: { id: string }) => item.id)).not.toContain(P.gala)
  })

  it('answers 401 without a session', async () => {
    const response = await request(subject.app).get('/api/events/mariage/photos')

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('answers 404 for a host of another event, never 403', async () => {
    const agent = await signedIn(subject, 'gala')

    const response = await agent.get('/api/events/mariage/photos')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })

  it('refuses a guest device token', async () => {
    const response = await request(subject.app)
      .get('/api/events/mariage/photos')
      .set('Cookie', guestCookie(subject))

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it.each([
    { label: 'a status outside the enum', query: 'status=deleted-forever' },
    { label: 'a page size of zero', query: 'limit=0' },
    { label: 'an unexpected key', query: 'authoredBy=guest-1' },
  ])('answers 400 for $label', async ({ query }) => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get(`/api/events/mariage/photos?${query}`)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })
})

describe('PATCH /api/events/:eventSlug/photos/:photoId/status', () => {
  it.each([
    { decision: 'publish', photoId: P.olderPending, from: 'pending', to: 'published' },
    { decision: 'reject', photoId: P.pending, from: 'pending', to: 'rejected' },
    { decision: 'hide', photoId: P.published, from: 'published', to: 'hidden' },
  ])('applies $decision to a $from photo', async ({ decision, photoId, to }) => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent
      .patch(`/api/events/mariage/photos/${photoId}/status`)
      .send({ decision })

    expect(response.status).toBe(204)
    expect(await statusOf(subject, photoId)).toBe(to)
    expect(subject.bus.published).toContainEqual(
      expect.objectContaining({ type: 'photo.moderated', status: to }),
    )
  })

  it('answers 409 for a transition the status machine refuses', async () => {
    // A pending photo cannot be hidden: "take it off the wall" presupposes it reached
    // the wall. Nothing is announced, so no projector re-reads its playlist.
    const agent = await signedIn(subject, 'moderator')

    const response = await agent
      .patch(`/api/events/mariage/photos/${P.pending}/status`)
      .send({ decision: 'hide' })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('photo.illegalTransition')
    expect(await statusOf(subject, P.pending)).toBe('pending')
    expect(subject.bus.published).toHaveLength(0)
  })

  it('answers 404 for a photo of another event, never 403', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent
      .patch(`/api/events/mariage/photos/${P.gala}/status`)
      .send({ decision: 'publish' })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('photo.notFound')
  })

  it('answers 401 without a session', async () => {
    const response = await request(subject.app)
      .patch(`/api/events/mariage/photos/${P.pending}/status`)
      .send({ decision: 'publish' })

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('answers 404 for a host of another event, never 403', async () => {
    const agent = await signedIn(subject, 'gala')

    const response = await agent
      .patch(`/api/events/mariage/photos/${P.pending}/status`)
      .send({ decision: 'publish' })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
    expect(await statusOf(subject, P.pending)).toBe('pending')
  })

  it('refuses a guest device token: what the room sees is the host alone', async () => {
    const response = await request(subject.app)
      .patch(`/api/events/mariage/photos/${P.pending}/status`)
      .set('Cookie', guestCookie(subject))
      .send({ decision: 'publish' })

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
    expect(await statusOf(subject, P.pending)).toBe('pending')
  })

  it.each([
    // The vocabulary boundary: the client sends the host's verb, never the resulting
    // state, so a client can never post a status it invented.
    { label: 'the resulting state instead of the verb', body: { decision: 'published' } },
    { label: 'a decision outside the enum', body: { decision: 'burn' } },
    { label: 'no decision at all', body: {} },
    { label: 'an unexpected key', body: { decision: 'publish', reason: 'flou' } },
  ])('answers 400 for $label', async ({ body }) => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.patch(`/api/events/mariage/photos/${P.pending}/status`).send(body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
    expect(await statusOf(subject, P.pending)).toBe('pending')
  })

  it('answers 400 for a photo id that is not a uuid', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent
      .patch('/api/events/mariage/photos/photo-1/status')
      .send({ decision: 'publish' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })
})

describe('POST /api/events/:eventSlug/moderation/bulk', () => {
  it('applies what the decision can legally do and reports what it skipped', async () => {
    // A bulk action across a screenful must not be lost because one photo was already
    // rejected — and the host is told which ones were left alone.
    const agent = await signedIn(subject, 'moderator')

    const response = await agent
      .post('/api/events/mariage/moderation/bulk')
      .send({ photoIds: [P.published, P.pending], decision: 'hide' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ applied: [P.published], skipped: [P.pending] })
    expect(await statusOf(subject, P.published)).toBe('hidden')
    expect(await statusOf(subject, P.pending)).toBe('pending')
  })

  it('neither applies nor reports an id from another event', async () => {
    // Reporting it as skipped would confirm that a photo the caller may not see exists.
    const agent = await signedIn(subject, 'moderator')

    const response = await agent
      .post('/api/events/mariage/moderation/bulk')
      .send({ photoIds: [P.pending, P.gala], decision: 'publish' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ applied: [P.pending], skipped: [] })
    const gala = await subject.photos.findById(asEventId(GALA), asPhotoId(P.gala))
    expect(gala?.status).toBe('pending')
  })

  it('answers 401 without a session', async () => {
    const response = await request(subject.app)
      .post('/api/events/mariage/moderation/bulk')
      .send({ photoIds: [P.pending], decision: 'publish' })

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('answers 404 for a host of another event, never 403', async () => {
    const agent = await signedIn(subject, 'gala')

    const response = await agent
      .post('/api/events/mariage/moderation/bulk')
      .send({ photoIds: [P.pending], decision: 'publish' })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
    expect(await statusOf(subject, P.pending)).toBe('pending')
  })

  it('refuses a guest device token', async () => {
    const response = await request(subject.app)
      .post('/api/events/mariage/moderation/bulk')
      .set('Cookie', guestCookie(subject))
      .send({ photoIds: [P.pending], decision: 'publish' })

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it.each([
    { label: 'an empty selection', body: { photoIds: [], decision: 'publish' } },
    { label: 'an id that is not a uuid', body: { photoIds: ['photo-1'], decision: 'publish' } },
    {
      label: 'the resulting state instead of the verb',
      body: { photoIds: [P.pending], decision: 'published' },
    },
    { label: 'no decision', body: { photoIds: [P.pending] } },
    {
      label: 'a selection past the cap',
      body: { photoIds: Array.from({ length: 201 }, () => P.pending), decision: 'publish' },
    },
  ])('answers 400 for $label', async ({ body }) => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.post('/api/events/mariage/moderation/bulk').send(body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })
})

/**
 * These exercise this router alone, which is **not** what the assembled server does on
 * this path: `guestRoutes` registers the same `DELETE` behind `requireGuest`, and
 * `server.ts` mounts it first. `requireGuest` answers 401 and does not call `next()`
 * when there is no `es_guest` cookie, so on the real server a moderator's session-only
 * request is refused by the guest handler and never arrives here. Reported rather than
 * fixed: the shared path needs one handler that picks the actor from whichever
 * principal is present, and `server.ts` is not this module's to edit.
 */
describe('DELETE /api/events/:eventSlug/photos/:photoId', () => {
  it('lets a moderator delete any photo in their event, media before row', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.delete(`/api/events/mariage/photos/${P.published}`)

    expect(response.status).toBe(204)
    expect(await statusOf(subject, P.published)).toBeNull()
    expect(subject.media.deleted).toHaveLength(1)
    expect(subject.bus.published).toContainEqual(
      expect.objectContaining({ type: 'photo.deleted', photoId: P.published }),
    )
  })

  it('answers 401 without a session', async () => {
    const response = await request(subject.app).delete(`/api/events/mariage/photos/${P.published}`)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
    expect(await statusOf(subject, P.published)).toBe('published')
  })

  it('answers 404 for a photo of another event, never 403', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.delete(`/api/events/mariage/photos/${P.gala}`)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('photo.notFound')
    const gala = await subject.photos.findById(asEventId(GALA), asPhotoId(P.gala))
    expect(gala).not.toBeNull()
  })

  it('answers 404 for a host of another event, never 403', async () => {
    const agent = await signedIn(subject, 'gala')

    const response = await agent.delete(`/api/events/mariage/photos/${P.published}`)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
    expect(await statusOf(subject, P.published)).toBe('published')
  })

  it('refuses a guest device token on the moderator handler', async () => {
    const response = await request(subject.app)
      .delete(`/api/events/mariage/photos/${P.published}`)
      .set('Cookie', guestCookie(subject))

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
    expect(await statusOf(subject, P.published)).toBe('published')
  })

  it('answers 400 for a photo id that is not a uuid', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.delete('/api/events/mariage/photos/photo-1')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })
})

describe('GET /api/events/:eventSlug/top-photos', () => {
  /** Two published photos, the first ahead of the second. */
  const seedWallReactions = (target: World): void => {
    target.reactions.seed(
      aReaction({
        id: 'r-1',
        eventId: WEDDING,
        photoId: P.published,
        guestId: 'guest-1',
        kind: 'love',
      }),
      aReaction({
        id: 'r-2',
        eventId: WEDDING,
        photoId: P.published,
        guestId: 'guest-2',
        kind: 'laugh',
      }),
      aReaction({
        id: 'r-3',
        eventId: WEDDING,
        photoId: P.publishedTwo,
        guestId: 'guest-1',
        kind: 'wow',
      }),
    )
  }

  /**
   * The room's favourite, which the host has since turned down. Reactions only land on
   * a published photo, but a photo keeps them when it is rejected afterwards.
   */
  const seedRejectedFavourite = (target: World): void => {
    target.reactions.seed(
      aReaction({
        id: 'r-4',
        eventId: WEDDING,
        photoId: P.rejected,
        guestId: 'guest-1',
        kind: 'love',
      }),
      aReaction({
        id: 'r-5',
        eventId: WEDDING,
        photoId: P.rejected,
        guestId: 'guest-2',
        kind: 'love',
      }),
      aReaction({
        id: 'r-6',
        eventId: WEDDING,
        photoId: P.rejected,
        guestId: 'guest-3',
        kind: 'clap',
      }),
      aReaction({
        id: 'r-7',
        eventId: WEDDING,
        photoId: P.rejected,
        guestId: 'guest-4',
        kind: 'cheers',
      }),
    )
  }

  it('ranks the wall by total reactions and never crowns a photo taken off it', async () => {
    seedWallReactions(subject)
    seedRejectedFavourite(subject)
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/top-photos')

    expect(response.status).toBe(200)
    expect(response.body.items).toEqual([
      {
        photoId: P.published,
        thumbUrl: `/api/events/mariage/photos/${P.published}/thumb`,
        counts: { love: 1, laugh: 1, wow: 0, cheers: 0, clap: 0 },
        total: 2,
      },
      {
        photoId: P.publishedTwo,
        thumbUrl: `/api/events/mariage/photos/${P.publishedTwo}/thumb`,
        counts: { love: 0, laugh: 0, wow: 1, cheers: 0, clap: 0 },
        total: 1,
      },
    ])
  })

  it('honours the podium size', async () => {
    seedWallReactions(subject)
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/top-photos?limit=1')

    expect(response.body.items.map((item: { photoId: string }) => item.photoId)).toEqual([
      P.published,
    ])
  })

  it('returns a shorter podium when the room favourite is no longer on the wall', async () => {
    // `getTopPhotos` applies the limit to the ranking and *then* drops what is no
    // longer on the wall, so a podium of one whose winner has since been rejected
    // comes back empty rather than promoting the runner-up. Asserted here because the
    // panel has to render a short list, not because this route decides it.
    seedWallReactions(subject)
    seedRejectedFavourite(subject)
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/top-photos?limit=1')

    expect(response.status).toBe(200)
    expect(response.body.items).toEqual([])
  })

  it('is never stored', async () => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get('/api/events/mariage/top-photos')

    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('answers 401 without a session', async () => {
    const response = await request(subject.app).get('/api/events/mariage/top-photos')

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('answers 404 for a host of another event, never 403', async () => {
    // `getTopPhotos` takes no actor, so this route's middleware is the only thing
    // standing between another host's event and this panel.
    seedWallReactions(subject)
    const agent = await signedIn(subject, 'gala')

    const response = await agent.get('/api/events/mariage/top-photos')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })

  it('refuses a guest device token', async () => {
    const response = await request(subject.app)
      .get('/api/events/mariage/top-photos')
      .set('Cookie', guestCookie(subject))

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it.each([
    { label: 'a podium of zero', query: 'limit=0' },
    { label: 'a podium past the cap', query: 'limit=500' },
    { label: 'an unexpected key', query: 'since=hier' },
  ])('answers 400 for $label', async ({ query }) => {
    const agent = await signedIn(subject, 'moderator')

    const response = await agent.get(`/api/events/mariage/top-photos?${query}`)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })
})

// ---------------------------------------------------------- withModerator --

/**
 * The narrowing every handler above relies on.
 *
 * Unreachable behind `requireRole`, which is the point: a route mounted without its
 * authorization decision must fail loudly rather than address an event of `undefined`
 * or invent an actor. Each case is a mounting mistake, and each must answer 500 — never
 * a 2xx, and never a decision applied to some other event.
 */
describe('withModerator', () => {
  const guarded = (): Harness => {
    const harness = buildHarness({
      routes: (app, deps) => {
        app.post('/sign-in', signInAs({ userId: MODERATOR, email: 'moderateur@example.test' }))
        // No authorization middleware at all: neither principal nor event resolved.
        app.get(
          '/bare',
          withModerator(async (_scope, _req, res) => {
            sendNoContent(res)
          }),
        )
        // The event resolved but no principal: what a public route leaves behind.
        app.get(
          '/events/:eventSlug/half',
          resolvePublicEvent(deps),
          withModerator(async (_scope, _req, res) => {
            sendNoContent(res)
          }),
        )
      },
    })
    harness.events.seed(anEvent({ id: WEDDING, slug: 'mariage', ownerId: OWNER }))
    return harness
  }

  it('refuses a route mounted with no authorization decision', async () => {
    const response = await request(guarded().app).get('/bare')

    expect(response.status).toBe(500)
    expect(response.body.error.code).toBe('server.unexpected')
    // The deliberate refusal, not a dereference of `undefined`: the error handler
    // stamps a `requestId` into the details of anything it did not expect, and a `!`
    // in place of this guard would answer 500 with exactly that.
    expect(response.body.error.details).toEqual({})
  })

  it('refuses a signed-in caller when no event was resolved', async () => {
    // A session is not authorization: without the event there is nothing to be a
    // moderator *of*, so the handler must not run at all.
    const harness = guarded()
    const agent = request.agent(harness.app)
    await agent.post('/sign-in').expect(204)

    const response = await agent.get('/bare')

    expect(response.status).toBe(500)
    expect(response.body.error.code).toBe('server.unexpected')
    expect(response.body.error.details).toEqual({})
  })

  it('refuses an event resolved without a principal', async () => {
    const response = await request(guarded().app).get('/events/mariage/half')

    expect(response.status).toBe(500)
    expect(response.body.error.code).toBe('server.unexpected')
    expect(response.body.error.details).toEqual({})
  })
})
