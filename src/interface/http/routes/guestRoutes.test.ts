import type { Express } from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { guestRoutes, withGuest } from './guestRoutes'
import { GUEST_COOKIE, requireRole, resolvePublicEvent } from '../middleware/authz'
import { sendNoContent } from '../presenters/send'
import { buildHarness, signInAs, type Harness } from '../testing/middlewareHarness'
import type { HttpConfig } from '../types'
import type { MediaMetadata, MediaStore } from '../../../application/ports/mediaStore'
import { AT, aGuest, aPhoto, aReaction, anEvent } from '../../../application/testing/builders'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { FakeReactionRepository } from '../../../application/testing/fakeReactionRepository'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import { makeDeletePhoto } from '../../../application/usecases/photos/deletePhoto'
import { makeListGuestPhotos } from '../../../application/usecases/photos/listGuestPhotos'
import { makeSetPhotoCaption } from '../../../application/usecases/photos/setPhotoCaption'
import type {
  UploadOutcome,
  UploadPhotos,
  UploadPhotosInput,
  UploadPhotosResult,
} from '../../../application/usecases/photos/uploadPhotos'
import { makeGetPhotoReactions } from '../../../application/usecases/reactions/getPhotoReactions'
import {
  makeReactToPhoto,
  type ReactionBudgetPolicy,
} from '../../../application/usecases/reactions/reactToPhoto'
import { makeWithdrawReaction } from '../../../application/usecases/reactions/withdrawReaction'
import type { EventSettingsPatch } from '../../../domain/events/eventSettings'
import type { ContentHash } from '../../../domain/photos/contentHash'
import { DomainError } from '../../../domain/shared/errors'
import { asEventId, asPhotoId, asUserId, type EventId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'

/**
 * The guest surface, driven through a real Express app.
 *
 * The use cases are the real ones, built from the in-memory fakes, so the rules these
 * routes must respect — a published photo is the host's to pull, another guest's photo
 * is not yours, another event's photo does not exist — are decided by the domain here
 * exactly as they are in production. Only `uploadPhotos` is scripted, for the reason
 * given on {@link ScriptedUploadPhotos}.
 */

const WEDDING = 'wedding-id'
const GALA = 'gala-id'
const GUEST = 'guest-1'
const OTHER_GUEST = 'guest-2'
/** A moderator of the wedding, for the one path the host surface also owns. */
const MODERATOR = '99999999-9999-4999-8999-999999999999'
const MODERATOR_EMAIL = 'moderateur@example.test'

/**
 * Photo ids are UUIDs because `photoParams` says so — the ids in a URL are opaque and
 * unguessable, unlike 1.0's autoincrementing integers.
 */
const PENDING = '11111111-1111-4111-8111-111111111111'
const PUBLISHED = '22222222-2222-4222-8222-222222222222'
const REJECTED = '33333333-3333-4333-8333-333333333333'
const ANOTHER_GUESTS = '44444444-4444-4444-8444-444444444444'
/** Lives in the gala. Reachable only if tenant scoping is broken. */
const GALA_PHOTO = '55555555-5555-4555-8555-555555555555'

const BASE = '/api/events/mariage'

/** An empty cookie is what a cleared or never-set device token looks like on the wire. */
const NO_TOKEN = ''

/**
 * What the route tables below issue their request through.
 *
 * `request(app)` for a one-shot call and `request.agent(app)` when the session cookie
 * has to survive a sign-in; supertest returns the same type for both, so one table can
 * be walked by a signed-in caller and an anonymous one alike.
 */
type Client = ReturnType<typeof request>

// ------------------------------------------------------------- test doubles --

const unreached = (method: string): string =>
  `MediaStore.${method} is not reached from the guest surface`

/**
 * A `MediaStore` that records deletions and refuses everything else.
 *
 * Only `delete` is reachable from here — a guest taking a photo back. The rest throw
 * rather than answering politely, so a route that started reading or writing bytes
 * itself fails loudly instead of passing against a store that shrugs.
 */
class RecordingMediaStore implements MediaStore {
  readonly deleted: string[] = []

  async delete(eventId: EventId, hash: ContentHash): Promise<void> {
    this.deleted.push(`${eventId}:${hash.value}`)
  }

  async put(): Promise<void> {
    throw new Error(unreached('put'))
  }

  async exists(): Promise<boolean> {
    throw new Error(unreached('exists'))
  }

  async stat(): Promise<MediaMetadata | null> {
    throw new Error(unreached('stat'))
  }

  async openRead(): Promise<AsyncIterable<Uint8Array> | null> {
    throw new Error(unreached('openRead'))
  }

  async read(): Promise<Uint8Array | null> {
    throw new Error(unreached('read'))
  }

  async deleteEvent(): Promise<void> {
    throw new Error(unreached('deleteEvent'))
  }

  async usedBytes(): Promise<number> {
    throw new Error(unreached('usedBytes'))
  }
}

/**
 * A programmable `uploadPhotos`.
 *
 * The real ingest needs an image processor, a media store and a hasher, and its own
 * suite already proves what it decides about a batch. What is under test here is the
 * controller: that multer is wired to the `photos` field with memory storage, that the
 * event and the author come from the resolved token rather than from the path, and that
 * every outcome reaches the wire in order. Scripting the result is the only way to
 * produce a refusal and a duplicate deterministically, and `calls` is what proves the
 * controller handed over the bytes it was given rather than a filename.
 */
class ScriptedUploadPhotos {
  readonly calls: UploadPhotosInput[] = []

  private result: Result<UploadPhotosResult, DomainError> = ok({ outcomes: [], published: [] })

  succeedsWith(...outcomes: readonly UploadOutcome[]): this {
    this.result = ok({ outcomes, published: [] })
    return this
  }

  failsWith(error: DomainError): this {
    this.result = { ok: false, error }
    return this
  }

  readonly run: UploadPhotos = async (input) => {
    this.calls.push(input)
    return this.result
  }
}

const stored = (index: number, photoId: string): UploadOutcome => ({
  index,
  declaredName: `photo-${index}.jpg`,
  kind: 'stored',
  photoId: asPhotoId(photoId),
})

const duplicate = (index: number, photoId: string): UploadOutcome => ({
  index,
  declaredName: `photo-${index}.jpg`,
  kind: 'duplicate',
  photoId: asPhotoId(photoId),
})

const refused = (index: number, error: DomainError): UploadOutcome => ({
  index,
  declaredName: `photo-${index}.jpg`,
  kind: 'refused',
  error,
})

// ------------------------------------------------------------------ harness --

interface Subject {
  readonly harness: Harness
  readonly app: Express
  readonly photos: FakePhotoRepository
  readonly reactions: FakeReactionRepository
  readonly media: RecordingMediaStore
  readonly upload: ScriptedUploadPhotos
  /** Paths the stand-in moderator handler answered, so a deferral is observable. */
  readonly hostHandlerReached: readonly string[]
  /** A valid token for the wedding, which is the event in every path below. */
  readonly token: string
  /** A valid token naming the gala: the cross-event attack. */
  readonly galaToken: string
}

interface SubjectOptions {
  readonly settings?: EventSettingsPatch
  readonly budget?: ReactionBudgetPolicy
  readonly config?: Partial<HttpConfig>
  readonly revoked?: boolean
}

/**
 * The wedding, the gala, two guests and five photos, behind the seven guest routes.
 *
 * The `usecases` bag is built here rather than in the shared harness because the shared
 * harness is being used by every other route module at the same time. It holds exactly
 * the seven `guestRoutes` declares, which is what `GuestRouteDeps` being a `Pick` buys.
 */
const buildSubject = (options: SubjectOptions = {}): Subject => {
  const photos = new FakePhotoRepository()
  const reactions = new FakeReactionRepository()
  const media = new RecordingMediaStore()
  const upload = new ScriptedUploadPhotos()
  const ids = new SequentialIdGenerator()
  const budget = options.budget ?? { windowMs: 60_000, maxPerWindow: 30 }
  const hostHandlerReached: string[] = []

  const harness = buildHarness({
    ...(options.config === undefined ? {} : { config: options.config }),
    routes: (app, deps) => {
      app.use(
        '/api',
        guestRoutes({
          deps,
          usecases: {
            uploadPhotos: upload.run,
            listGuestPhotos: makeListGuestPhotos({ events: deps.events, photos }),
            deletePhoto: makeDeletePhoto({
              events: deps.events,
              photos,
              media,
              bus: deps.bus,
              clock: deps.clock,
            }),
            setPhotoCaption: makeSetPhotoCaption({
              events: deps.events,
              photos,
              bus: deps.bus,
              clock: deps.clock,
            }),
            reactToPhoto: makeReactToPhoto({
              events: deps.events,
              photos,
              reactions,
              bus: deps.bus,
              clock: deps.clock,
              ids,
              budget,
            }),
            withdrawReaction: makeWithdrawReaction({ reactions }),
            getPhotoReactions: makeGetPhotoReactions({ photos, reactions }),
          },
        }),
      )

      // Stands in for `moderationRoutes`, which owns the same `DELETE` for a moderator
      // and which `server.ts` mounts after this router. Real `requireRole`, so what a
      // deferred request meets here is what it meets in production; the handler only
      // records that it was reached, since deleting is the other module's test.
      app.delete(
        '/api/events/:eventSlug/photos/:photoId',
        requireRole('moderator', deps),
        (req, res) => {
          hostHandlerReached.push(req.path)
          sendNoContent(res)
        },
      )
      app.post('/sign-in/moderator', signInAs({ userId: MODERATOR, email: MODERATOR_EMAIL }))
    },
  })

  harness.events.seed(
    anEvent({
      id: WEDDING,
      slug: 'mariage',
      joinCode: 'H7K2QM',
      ...(options.settings === undefined ? {} : { settings: options.settings }),
    }),
    anEvent({ id: GALA, slug: 'gala', joinCode: 'B4N9PT' }),
  )

  harness.guests.seed(
    aGuest({
      id: GUEST,
      eventId: WEDDING,
      displayName: 'Léa',
      ...(options.revoked === true ? { revokedAt: AT } : {}),
    }),
    aGuest({ id: OTHER_GUEST, eventId: WEDDING, displayName: 'Sacha' }),
  )

  harness.memberships.seed({
    eventId: asEventId(WEDDING),
    userId: asUserId(MODERATOR),
    role: 'moderator',
    grantedAt: AT,
  })

  photos.seed(
    aPhoto({ id: PENDING, eventId: WEDDING, author: { kind: 'guest', id: GUEST } }),
    aPhoto({
      id: PUBLISHED,
      eventId: WEDDING,
      status: 'published',
      author: { kind: 'guest', id: GUEST },
    }),
    aPhoto({
      id: REJECTED,
      eventId: WEDDING,
      status: 'rejected',
      author: { kind: 'guest', id: GUEST },
    }),
    aPhoto({
      id: ANOTHER_GUESTS,
      eventId: WEDDING,
      author: { kind: 'guest', id: OTHER_GUEST },
    }),
    aPhoto({
      id: GALA_PHOTO,
      eventId: GALA,
      status: 'published',
      author: { kind: 'guest', id: GUEST },
    }),
  )

  return {
    harness,
    app: harness.app,
    photos,
    reactions,
    media,
    upload,
    hostHandlerReached,
    token: harness.issueGuestToken(WEDDING, GUEST),
    galaToken: harness.issueGuestToken(GALA, GUEST),
  }
}

const cookie = (token: string): string => `${GUEST_COOKIE}=${token}`

// ------------------------------------------------------ upload: POST /photos --

describe('POST /api/events/:eventSlug/photos', () => {
  it('answers 201 with one outcome per file, in the order they were submitted', async () => {
    const subject = buildSubject()
    subject.upload.succeedsWith(stored(0, PENDING), stored(1, PUBLISHED))

    const response = await request(subject.app)
      .post(`${BASE}/photos`)
      .set('Cookie', cookie(subject.token))
      .field('caption', 'Les confettis')
      .attach('photos', Buffer.from('first-bytes'), 'first.jpg')
      .attach('photos', Buffer.from('second-bytes'), 'second.jpg')

    expect(response.status).toBe(201)
    expect(response.body.results).toEqual([
      { index: 0, status: 'accepted', photoId: PENDING },
      { index: 1, status: 'accepted', photoId: PUBLISHED },
    ])
  })

  it('hands the use case the received bytes, the resolved event and the guest author', async () => {
    // The event and the author come from the verified token, never from the path — the
    // 1.0 upload endpoint took its event from a query parameter.
    const subject = buildSubject()
    subject.upload.succeedsWith(stored(0, PENDING))

    await request(subject.app)
      .post(`${BASE}/photos`)
      .set('Cookie', cookie(subject.token))
      .field('caption', 'Les confettis')
      .attach('photos', Buffer.from('first-bytes'), 'first.jpg')
      .expect(201)

    const call = subject.upload.calls[0]
    expect(call?.eventId).toBe(WEDDING)
    expect(call?.author).toEqual({ kind: 'guest', guestId: GUEST })
    expect(call?.files).toHaveLength(1)
    expect(Buffer.from(call?.files[0]?.bytes ?? []).toString()).toBe('first-bytes')
    expect(call?.files[0]?.declaredName).toBe('first.jpg')
    expect(call?.caption).toBe('Les confettis')
  })

  it('omits the caption entirely when the form sent none', async () => {
    // Absent and "cleared" are different intents under exactOptionalPropertyTypes, and
    // only the second may reach the domain as a value.
    const subject = buildSubject()
    subject.upload.succeedsWith(stored(0, PENDING))

    await request(subject.app)
      .post(`${BASE}/photos`)
      .set('Cookie', cookie(subject.token))
      .attach('photos', Buffer.from('first-bytes'), 'first.jpg')
      .expect(201)

    expect(subject.upload.calls.map((call) => 'caption' in call)).toEqual([false])
  })

  it('reports a duplicate as a success, because a retry is not a failure', async () => {
    // A double-tapped "Envoyer" or a reconnect mid-upload. 1.0 answered it with a
    // second identical slide on the wall.
    const subject = buildSubject()
    subject.upload.succeedsWith(duplicate(0, PENDING))

    const response = await request(subject.app)
      .post(`${BASE}/photos`)
      .set('Cookie', cookie(subject.token))
      .attach('photos', Buffer.from('same-bytes'), 'again.jpg')

    expect(response.status).toBe(201)
    expect(response.body.results).toEqual([{ index: 0, status: 'duplicate', photoId: PENDING }])
  })

  it('names the one refused file and still accepts the others', async () => {
    // A guest who selected five photos and one screenshot must not have to re-pick all
    // six on venue Wi-Fi.
    const subject = buildSubject()
    subject.upload.succeedsWith(
      stored(0, PENDING),
      refused(1, DomainError.quotaExceeded('image.tooManyPixels')),
      stored(2, PUBLISHED),
    )

    const response = await request(subject.app)
      .post(`${BASE}/photos`)
      .set('Cookie', cookie(subject.token))
      .attach('photos', Buffer.from('one'), 'one.jpg')
      .attach('photos', Buffer.from('two'), 'two.jpg')
      .attach('photos', Buffer.from('three'), 'three.jpg')

    expect(response.status).toBe(201)
    expect(response.body.results).toEqual([
      { index: 0, status: 'accepted', photoId: PENDING },
      { index: 1, status: 'rejected', code: 'image.tooManyPixels' },
      { index: 2, status: 'accepted', photoId: PUBLISHED },
    ])
  })

  it('answers 400 for a multipart request carrying no file at all', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .post(`${BASE}/photos`)
      .set('Cookie', cookie(subject.token))
      .field('caption', 'sans photo')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('upload.noFiles')
    expect(subject.upload.calls).toHaveLength(0)
  })

  it('answers 400 when the request was not multipart at all', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .post(`${BASE}/photos`)
      .set('Cookie', cookie(subject.token))
      .send({ photos: 'not-a-file' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('upload.noFiles')
  })

  it('answers 400 for a text field this contract does not define', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .post(`${BASE}/photos`)
      .set('Cookie', cookie(subject.token))
      .field('nickname', 'Léa')
      .attach('photos', Buffer.from('one'), 'one.jpg')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
    expect(subject.upload.calls).toHaveLength(0)
  })

  it('answers 400 for a file sent under a field name that is not photos', async () => {
    // `LIMIT_UNEXPECTED_FILE` from multer, translated once in the error handler.
    const subject = buildSubject()

    const response = await request(subject.app)
      .post(`${BASE}/photos`)
      .set('Cookie', cookie(subject.token))
      .attach('image', Buffer.from('one'), 'one.jpg')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('upload.unexpectedField')
  })

  it('answers 413 for a file over the configured byte limit', async () => {
    const subject = buildSubject({
      config: { uploads: { maxBytes: 8, maxFiles: 20 } },
    })

    const response = await request(subject.app)
      .post(`${BASE}/photos`)
      .set('Cookie', cookie(subject.token))
      .attach('photos', Buffer.alloc(64, 0x41), 'huge.jpg')

    expect(response.status).toBe(413)
    expect(response.body.error.code).toBe('upload.tooLarge')
  })

  it('answers 400 for more files than the deployment allows in one request', async () => {
    const subject = buildSubject({
      config: { uploads: { maxBytes: 25_000_000, maxFiles: 1 } },
    })

    const response = await request(subject.app)
      .post(`${BASE}/photos`)
      .set('Cookie', cookie(subject.token))
      .attach('photos', Buffer.from('one'), 'one.jpg')
      .attach('photos', Buffer.from('two'), 'two.jpg')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('upload.tooManyFiles')
  })

  it('answers 403 guest.wrongEvent for a token issued for another event', async () => {
    // The cross-event attack: a guest at the gala pointing their own cookie at the
    // wedding's upload endpoint.
    const subject = buildSubject()

    const response = await request(subject.app)
      .post(`${BASE}/photos`)
      .set('Cookie', cookie(subject.galaToken))
      .attach('photos', Buffer.from('one'), 'one.jpg')

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('guest.wrongEvent')
    expect(subject.upload.calls).toHaveLength(0)
  })

  it('answers 403 guest.revoked for a guest the host removed', async () => {
    const subject = buildSubject({ revoked: true })

    const response = await request(subject.app)
      .post(`${BASE}/photos`)
      .set('Cookie', cookie(subject.token))
      .attach('photos', Buffer.from('one'), 'one.jpg')

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('guest.revoked')
  })

  it('answers 401 with no cookie at all', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .post(`${BASE}/photos`)
      .attach('photos', Buffer.from('one'), 'one.jpg')

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('passes a domain refusal through at its own status', async () => {
    const subject = buildSubject()
    subject.upload.failsWith(DomainError.conflict('event.notAcceptingUploads'))

    const response = await request(subject.app)
      .post(`${BASE}/photos`)
      .set('Cookie', cookie(subject.token))
      .attach('photos', Buffer.from('one'), 'one.jpg')

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('event.notAcceptingUploads')
  })

  it('answers 429 once the per-minute upload budget is spent', async () => {
    const subject = buildSubject({
      config: {
        rateLimits: {
          uploadPerMinute: 1,
          joinPerMinute: 20,
          loginPerMinute: 10,
          reactionPerMinute: 30,
        },
      },
    })
    subject.upload.succeedsWith(stored(0, PENDING))

    await request(subject.app)
      .post(`${BASE}/photos`)
      .set('Cookie', cookie(subject.token))
      .attach('photos', Buffer.from('one'), 'one.jpg')
      .expect(201)

    const response = await request(subject.app)
      .post(`${BASE}/photos`)
      .set('Cookie', cookie(subject.token))
      .attach('photos', Buffer.from('two'), 'two.jpg')

    expect(response.status).toBe(429)
    expect(response.body.error.code).toBe('rate.limited')
  })
})

// ------------------------------------------------- mine: GET /photos/mine --

describe('GET /api/events/:eventSlug/photos/mine', () => {
  it('returns the guest own photos whatever their status', async () => {
    // A guest who cannot see that a photo is awaiting moderation sends it again, and
    // the host moderates the same photo twice.
    const subject = buildSubject()

    const response = await request(subject.app)
      .get(`${BASE}/photos/mine`)
      .set('Cookie', cookie(subject.token))

    expect(response.status).toBe(200)
    expect(response.body.items.map((item: { status: string }) => item.status)).toEqual([
      'pending',
      'published',
      'rejected',
    ])
  })

  it('carries the thumb url and the caption, and never a storage path', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .get(`${BASE}/photos/mine`)
      .set('Cookie', cookie(subject.token))

    expect(response.body.items[0]).toEqual({
      id: PENDING,
      status: 'pending',
      thumbUrl: `/api/events/mariage/photos/${PENDING}/thumb`,
      caption: null,
      createdAt: AT.toISOString(),
      canDelete: true,
    })
  })

  it('never shows another guest photo, nor one from another event', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .get(`${BASE}/photos/mine`)
      .set('Cookie', cookie(subject.token))

    const ids = response.body.items.map((item: { id: string }) => item.id)
    expect(ids).not.toContain(ANOTHER_GUESTS)
    expect(ids).not.toContain(GALA_PHOTO)
  })

  it('is never stored, so a reload always shows the current decision', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .get(`${BASE}/photos/mine`)
      .set('Cookie', cookie(subject.token))

    expect(response.headers['cache-control']).toBe('no-store')
  })

  it.each([
    { status: 'pending', id: PENDING, canDelete: true },
    { status: 'rejected', id: REJECTED, canDelete: true },
    { status: 'published', id: PUBLISHED, canDelete: false },
  ])('reports canDelete $canDelete for a $status photo', async ({ id, canDelete }) => {
    // Published is the host's to pull off the wall, so the button must already be off.
    const subject = buildSubject()

    const response = await request(subject.app)
      .get(`${BASE}/photos/mine`)
      .set('Cookie', cookie(subject.token))

    const item = response.body.items.find((candidate: { id: string }) => candidate.id === id)
    expect(item.canDelete).toBe(canDelete)
  })

  it('reports canDelete false past the grace window', async () => {
    const subject = buildSubject()
    subject.harness.clock.advance(16 * 60 * 1000)

    const response = await request(subject.app)
      .get(`${BASE}/photos/mine`)
      .set('Cookie', cookie(subject.token))

    const item = response.body.items.find((candidate: { id: string }) => candidate.id === PENDING)
    expect(item.canDelete).toBe(false)
  })

  it('reports canDelete false for every photo when the host turned self-deletion off', async () => {
    // It must agree with what DELETE would answer: a true here is the enabled button
    // that then fails, which is the whole reason the field is computed server-side.
    const subject = buildSubject({ settings: { allowGuestSelfDelete: false } })

    const response = await request(subject.app)
      .get(`${BASE}/photos/mine`)
      .set('Cookie', cookie(subject.token))

    const flags = response.body.items.map((item: { canDelete: boolean }) => item.canDelete)
    expect(flags).toEqual([false, false, false])

    const refusal = await request(subject.app)
      .delete(`${BASE}/photos/${PENDING}`)
      .set('Cookie', cookie(subject.token))

    expect(refusal.status).toBe(403)
    expect(refusal.body.error.code).toBe('event.guestSelfDeleteDisabled')
  })
})

// --------------------------------------------- delete: DELETE /photos/:id --

describe('DELETE /api/events/:eventSlug/photos/:photoId', () => {
  it('lets the author take back their own pending photo inside the window', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .delete(`${BASE}/photos/${PENDING}`)
      .set('Cookie', cookie(subject.token))

    expect(response.status).toBe(204)
    expect(await subject.photos.findById(asEventId(WEDDING), asPhotoId(PENDING))).toBe(null)
    expect(subject.media.deleted).toHaveLength(1)
    expect(subject.harness.bus.published).toContainEqual(
      expect.objectContaining({ type: 'photo.deleted' }),
    )
  })

  it('refuses a published photo, because pulling it off the wall is the host call', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .delete(`${BASE}/photos/${PUBLISHED}`)
      .set('Cookie', cookie(subject.token))

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('photo.deleteForbidden')
  })

  it('refuses another guest photo', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .delete(`${BASE}/photos/${ANOTHER_GUESTS}`)
      .set('Cookie', cookie(subject.token))

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('photo.deleteForbidden')
  })

  it('refuses a photo whose grace window has closed', async () => {
    const subject = buildSubject()
    subject.harness.clock.advance(16 * 60 * 1000)

    const response = await request(subject.app)
      .delete(`${BASE}/photos/${PENDING}`)
      .set('Cookie', cookie(subject.token))

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('photo.deleteForbidden')
  })
})

// ------------------------------------- caption: PATCH /photos/:id/caption --

describe('PATCH /api/events/:eventSlug/photos/:photoId/caption', () => {
  it('writes the caption on the author own pending photo', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .patch(`${BASE}/photos/${PENDING}/caption`)
      .set('Cookie', cookie(subject.token))
      .send({ caption: 'Les confettis' })

    expect(response.status).toBe(204)
    const photo = await subject.photos.findById(asEventId(WEDDING), asPhotoId(PENDING))
    expect(photo?.caption?.value).toBe('Les confettis')
  })

  it('clears the caption when sent null', async () => {
    const subject = buildSubject()
    await request(subject.app)
      .patch(`${BASE}/photos/${PENDING}/caption`)
      .set('Cookie', cookie(subject.token))
      .send({ caption: 'Les confettis' })
      .expect(204)

    const response = await request(subject.app)
      .patch(`${BASE}/photos/${PENDING}/caption`)
      .set('Cookie', cookie(subject.token))
      .send({ caption: null })

    expect(response.status).toBe(204)
    const photo = await subject.photos.findById(asEventId(WEDDING), asPhotoId(PENDING))
    expect(photo?.caption).toBe(null)
  })

  it('refuses a caption on a photo already on the wall', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .patch(`${BASE}/photos/${PUBLISHED}/caption`)
      .set('Cookie', cookie(subject.token))
      .send({ caption: 'trop tard' })

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('photo.captionEditForbidden')
  })

  it('refuses a caption on another guest photo', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .patch(`${BASE}/photos/${ANOTHER_GUESTS}/caption`)
      .set('Cookie', cookie(subject.token))
      .send({ caption: 'pas la mienne' })

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('photo.captionEditForbidden')
  })

  it('refuses a caption when the host turned captions off', async () => {
    const subject = buildSubject({ settings: { allowCaptions: false } })

    const response = await request(subject.app)
      .patch(`${BASE}/photos/${PENDING}/caption`)
      .set('Cookie', cookie(subject.token))
      .send({ caption: 'interdite' })

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('event.captionsNotAllowed')
  })
})

// ------------------------------ reactions: POST /photos/:id/reactions --

describe('POST /api/events/:eventSlug/photos/:photoId/reactions', () => {
  it('records a reaction on a published photo', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .post(`${BASE}/photos/${PUBLISHED}/reactions`)
      .set('Cookie', cookie(subject.token))
      .send({ kind: 'love' })

    expect(response.status).toBe(204)
    expect(subject.harness.bus.published).toContainEqual(
      expect.objectContaining({ type: 'reaction.added', kind: 'love' }),
    )
  })

  it('answers 409 for the same kind twice, so a double tap is not a second count', async () => {
    const subject = buildSubject()
    await request(subject.app)
      .post(`${BASE}/photos/${PUBLISHED}/reactions`)
      .set('Cookie', cookie(subject.token))
      .send({ kind: 'love' })
      .expect(204)

    const response = await request(subject.app)
      .post(`${BASE}/photos/${PUBLISHED}/reactions`)
      .set('Cookie', cookie(subject.token))
      .send({ kind: 'love' })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('reaction.alreadyExists')
  })

  it('refuses a reaction on a pending photo: you react to what is on the wall', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .post(`${BASE}/photos/${PENDING}/reactions`)
      .set('Cookie', cookie(subject.token))
      .send({ kind: 'love' })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('reaction.notPublished')
  })

  it('answers 429 once this guest has spent their budget for the window', async () => {
    const subject = buildSubject({ budget: { windowMs: 60_000, maxPerWindow: 1 } })
    subject.reactions.seed(
      aReaction({ eventId: WEDDING, photoId: PUBLISHED, guestId: GUEST, kind: 'love' }),
    )

    const response = await request(subject.app)
      .post(`${BASE}/photos/${PUBLISHED}/reactions`)
      .set('Cookie', cookie(subject.token))
      .send({ kind: 'clap' })

    expect(response.status).toBe(429)
    expect(response.body.error.code).toBe('reaction.rateLimited')
  })

  it('refuses every reaction when the host turned them off', async () => {
    const subject = buildSubject({ settings: { allowReactions: false } })

    const response = await request(subject.app)
      .post(`${BASE}/photos/${PUBLISHED}/reactions`)
      .set('Cookie', cookie(subject.token))
      .send({ kind: 'love' })

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('event.reactionsDisabled')
  })
})

// -------------------------- reactions: DELETE /photos/:id/reactions/:kind --

describe('DELETE /api/events/:eventSlug/photos/:photoId/reactions/:kind', () => {
  it('withdraws the guest own reaction', async () => {
    const subject = buildSubject()
    subject.reactions.seed(
      aReaction({ eventId: WEDDING, photoId: PUBLISHED, guestId: GUEST, kind: 'love' }),
    )

    const response = await request(subject.app)
      .delete(`${BASE}/photos/${PUBLISHED}/reactions/love`)
      .set('Cookie', cookie(subject.token))

    expect(response.status).toBe(204)
  })

  it('answers 404 when there is nothing of that kind to withdraw', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .delete(`${BASE}/photos/${PUBLISHED}/reactions/love`)
      .set('Cookie', cookie(subject.token))

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('reaction.notFound')
  })

  it('cannot withdraw another guest reaction, which is simply not there', async () => {
    // Addressed by (event, photo, guest, kind), so another guest's row is never found
    // and the caller learns nothing about whether it exists.
    const subject = buildSubject()
    subject.reactions.seed(
      aReaction({ eventId: WEDDING, photoId: PUBLISHED, guestId: OTHER_GUEST, kind: 'love' }),
    )

    const response = await request(subject.app)
      .delete(`${BASE}/photos/${PUBLISHED}/reactions/love`)
      .set('Cookie', cookie(subject.token))

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('reaction.notFound')
  })
})

// ------------------------------- reactions: GET /photos/:id/reactions --

describe('GET /api/events/:eventSlug/photos/:photoId/reactions', () => {
  it('always carries every kind, zeroed, plus this phone own taps', async () => {
    const subject = buildSubject()
    subject.reactions.seed(
      aReaction({ id: 'r-1', eventId: WEDDING, photoId: PUBLISHED, guestId: GUEST, kind: 'love' }),
      aReaction({
        id: 'r-2',
        eventId: WEDDING,
        photoId: PUBLISHED,
        guestId: OTHER_GUEST,
        kind: 'love',
      }),
      aReaction({
        id: 'r-3',
        eventId: WEDDING,
        photoId: PUBLISHED,
        guestId: OTHER_GUEST,
        kind: 'clap',
      }),
    )

    const response = await request(subject.app)
      .get(`${BASE}/photos/${PUBLISHED}/reactions`)
      .set('Cookie', cookie(subject.token))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      counts: { love: 2, laugh: 0, wow: 0, cheers: 0, clap: 1 },
      mine: ['love'],
    })
  })

  it('never leaks the unweighted total the photo of the night is ranked on', async () => {
    // Asserting the whole key set rather than `total === undefined`: an absent key is
    // also what a 404 body has, so the negative alone would hold even if the endpoint
    // had stopped answering.
    const subject = buildSubject()

    const response = await request(subject.app)
      .get(`${BASE}/photos/${PUBLISHED}/reactions`)
      .set('Cookie', cookie(subject.token))

    expect(response.status).toBe(200)
    expect(Object.keys(response.body).sort()).toEqual(['counts', 'mine'])
  })
})

// ------------------------------------------------- authorization, per route --

/**
 * Every route, in one table.
 *
 * A route with no authorization decision is the defect these cases exist to catch, and
 * the only way to be sure none was forgotten is to walk the whole surface.
 */
const ROUTES = [
  {
    name: 'POST /photos',
    sharedWithHost: false,
    send: (client: Client, token: string) =>
      client
        .post(`${BASE}/photos`)
        .set('Cookie', cookie(token))
        .attach('photos', Buffer.from('one'), 'one.jpg'),
  },
  {
    name: 'GET /photos/mine',
    sharedWithHost: false,
    send: (client: Client, token: string) =>
      client.get(`${BASE}/photos/mine`).set('Cookie', cookie(token)),
  },
  {
    // The one path the host surface also owns: a session-only caller is answered by
    // `moderationRoutes`, not refused here.
    name: 'DELETE /photos/:photoId',
    sharedWithHost: true,
    send: (client: Client, token: string) =>
      client.delete(`${BASE}/photos/${PENDING}`).set('Cookie', cookie(token)),
  },
  {
    name: 'PATCH /photos/:photoId/caption',
    sharedWithHost: false,
    send: (client: Client, token: string) =>
      client
        .patch(`${BASE}/photos/${PENDING}/caption`)
        .set('Cookie', cookie(token))
        .send({ caption: 'x' }),
  },
  {
    name: 'POST /photos/:photoId/reactions',
    sharedWithHost: false,
    send: (client: Client, token: string) =>
      client
        .post(`${BASE}/photos/${PUBLISHED}/reactions`)
        .set('Cookie', cookie(token))
        .send({ kind: 'love' }),
  },
  {
    name: 'DELETE /photos/:photoId/reactions/:kind',
    sharedWithHost: false,
    send: (client: Client, token: string) =>
      client.delete(`${BASE}/photos/${PUBLISHED}/reactions/love`).set('Cookie', cookie(token)),
  },
  {
    name: 'GET /photos/:photoId/reactions',
    sharedWithHost: false,
    send: (client: Client, token: string) =>
      client.get(`${BASE}/photos/${PUBLISHED}/reactions`).set('Cookie', cookie(token)),
  },
]

/** The routes this router owns outright, where a session grants nothing at all. */
const GUEST_ONLY_ROUTES = ROUTES.filter((route) => !route.sharedWithHost)

describe('the guest surface requires a guest token on every route', () => {
  it.each(ROUTES)('$name answers 401 without one', async ({ send }) => {
    const subject = buildSubject()

    const response = await send(request(subject.app), NO_TOKEN)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it.each(ROUTES)('$name answers 403 for a token naming another event', async ({ send }) => {
    const subject = buildSubject()

    const response = await send(request(subject.app), subject.galaToken)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('guest.wrongEvent')
  })

  it.each(ROUTES)('$name answers 403 once the host has revoked the guest', async ({ send }) => {
    const subject = buildSubject({ revoked: true })

    const response = await send(request(subject.app), subject.token)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('guest.revoked')
  })

  /**
   * A moderator's session is not a guest token.
   *
   * There is no ambient "logged in means allowed" here: the credential that grants the
   * guest surface is the event-scoped device token and nothing else, so a signed-in
   * moderator of this very event still gets 401 on the routes this router owns.
   */
  it.each(GUEST_ONLY_ROUTES)('$name answers 401 for a moderator session', async ({ send }) => {
    const subject = buildSubject()
    const agent = request.agent(subject.app)
    await agent.post('/sign-in/moderator').expect(204)

    const response = await send(agent, NO_TOKEN)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })
})

/**
 * The shared `DELETE`, which two principals own in docs/API.md.
 *
 * `server.ts` mounts this router before `moderationRoutes`, so a session-only request
 * would be swallowed by `requireGuest`'s 401 and section 6's "delete any photo" would be
 * a dead endpoint. The guest route declines instead, and the handler standing in for
 * `moderationRoutes` — behind the real `requireRole` — is what answers.
 */
describe('DELETE /api/events/:eventSlug/photos/:photoId is shared with the host surface', () => {
  it('defers to the moderator handler when no guest token is presented', async () => {
    const subject = buildSubject()
    const agent = request.agent(subject.app)
    await agent.post('/sign-in/moderator').expect(204)

    const response = await agent.delete(`${BASE}/photos/${ANOTHER_GUESTS}`)

    expect(response.status).toBe(204)
    expect(subject.hostHandlerReached).toEqual([`/api/events/mariage/photos/${ANOTHER_GUESTS}`])
  })

  it('keeps the guest handler when a guest token is presented', async () => {
    // The deferral keys on the cookie, so a guest at an event they do not moderate is
    // still answered here — and by their own rules, not a moderator's.
    const subject = buildSubject()

    const response = await request(subject.app)
      .delete(`${BASE}/photos/${ANOTHER_GUESTS}`)
      .set('Cookie', cookie(subject.token))

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('photo.deleteForbidden')
    expect(subject.hostHandlerReached).toEqual([])
  })

  it('refuses a caller with neither credential, without reaching either handler', async () => {
    const subject = buildSubject()

    const response = await request(subject.app).delete(`${BASE}/photos/${PENDING}`)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
    expect(subject.hostHandlerReached).toEqual([])
    expect(await subject.photos.findById(asEventId(WEDDING), asPhotoId(PENDING))).not.toBeNull()
  })
})

/**
 * A photo in another event answers **404**, never 403.
 *
 * A 403 would confirm the photo exists and turn every one of these into an enumeration
 * oracle over other people's evenings. The token here is valid for the wedding; the id
 * belongs to the gala.
 */
const CROSS_EVENT_ROUTES = [
  {
    name: 'DELETE /photos/:photoId',
    code: 'photo.notFound',
    send: (client: Client, token: string) =>
      client.delete(`${BASE}/photos/${GALA_PHOTO}`).set('Cookie', cookie(token)),
  },
  {
    name: 'PATCH /photos/:photoId/caption',
    code: 'photo.notFound',
    send: (client: Client, token: string) =>
      client
        .patch(`${BASE}/photos/${GALA_PHOTO}/caption`)
        .set('Cookie', cookie(token))
        .send({ caption: 'x' }),
  },
  {
    name: 'POST /photos/:photoId/reactions',
    code: 'photo.notFound',
    send: (client: Client, token: string) =>
      client
        .post(`${BASE}/photos/${GALA_PHOTO}/reactions`)
        .set('Cookie', cookie(token))
        .send({ kind: 'love' }),
  },
  {
    name: 'GET /photos/:photoId/reactions',
    code: 'photo.notFound',
    send: (client: Client, token: string) =>
      client.get(`${BASE}/photos/${GALA_PHOTO}/reactions`).set('Cookie', cookie(token)),
  },
  {
    name: 'DELETE /photos/:photoId/reactions/:kind',
    code: 'reaction.notFound',
    send: (client: Client, token: string) =>
      client.delete(`${BASE}/photos/${GALA_PHOTO}/reactions/love`).set('Cookie', cookie(token)),
  },
]

describe('a resource from another event does not exist', () => {
  it.each(CROSS_EVENT_ROUTES)('$name answers 404 $code', async ({ send, code }) => {
    const subject = buildSubject()

    const response = await send(request(subject.app), subject.token)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe(code)
  })
})

/** Shape failures, refused at the boundary before a use case ever runs. */
const INVALID_REQUESTS = [
  {
    name: 'a photo id that is not a uuid',
    send: (client: Client, token: string) =>
      client.delete(`${BASE}/photos/not-a-uuid`).set('Cookie', cookie(token)),
  },
  {
    name: 'a caption body with no caption key',
    send: (client: Client, token: string) =>
      client.patch(`${BASE}/photos/${PENDING}/caption`).set('Cookie', cookie(token)).send({}),
  },
  {
    name: 'a caption that is not a string',
    send: (client: Client, token: string) =>
      client
        .patch(`${BASE}/photos/${PENDING}/caption`)
        .set('Cookie', cookie(token))
        .send({ caption: 42 }),
  },
  {
    name: 'a caption body carrying an undefined key',
    send: (client: Client, token: string) =>
      client
        .patch(`${BASE}/photos/${PENDING}/caption`)
        .set('Cookie', cookie(token))
        .send({ caption: 'x', pinned: true }),
  },
  {
    name: 'a reaction kind outside the closed set',
    send: (client: Client, token: string) =>
      client
        .post(`${BASE}/photos/${PUBLISHED}/reactions`)
        .set('Cookie', cookie(token))
        .send({ kind: 'shrug' }),
  },
  {
    name: 'a reaction kind outside the closed set in the path',
    send: (client: Client, token: string) =>
      client.delete(`${BASE}/photos/${PUBLISHED}/reactions/shrug`).set('Cookie', cookie(token)),
  },
]

describe('the boundary refuses a malformed request', () => {
  it.each(INVALID_REQUESTS)('answers 400 for $name', async ({ send }) => {
    const subject = buildSubject()

    const response = await send(request(subject.app), subject.token)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })
})

// -------------------------------------------------------------- withGuest --

/**
 * The narrowing every handler here relies on.
 *
 * Unreachable behind `requireGuest`, which is the point: if the middleware is ever
 * dropped from a route, the route must fail closed rather than dereference an absent
 * principal and answer 500 after the fact.
 */
describe('withGuest', () => {
  const guarded = (): Harness =>
    buildHarness({
      routes: (app, deps) => {
        app.get(
          '/bare',
          withGuest(async (_scope, _req, res) => {
            sendNoContent(res)
          }),
        )
        // The event resolved but no guest principal: what a public route leaves behind.
        app.get(
          '/events/:eventSlug/half',
          resolvePublicEvent(deps),
          withGuest(async (_scope, _req, res) => {
            sendNoContent(res)
          }),
        )
      },
    })

  it('answers 401 when no authorization middleware ran at all', async () => {
    const response = await request(guarded().app).get('/bare')

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('answers 401 when the event resolved but no guest did', async () => {
    const subject = guarded()
    subject.events.seed(anEvent({ slug: 'mariage' }))

    const response = await request(subject.app).get('/events/mariage/half')

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })
})
