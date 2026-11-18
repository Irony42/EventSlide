import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Express } from 'express'
import request from '../testing/request'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { guestbookRoutes } from './guestbookRoutes'
import { guestbookVoiceRoutes } from './guestbookVoiceRoutes'
import { GUEST_COOKIE } from '../middleware/authz'
import { guestbookGuestLimiter } from '../middleware/rateLimit'
import { buildHarness, signInAs, testHttpConfig, type Harness } from '../testing/middlewareHarness'
import type { HttpConfig } from '../types'
import {
  AT,
  aGuest,
  aGuestbookEntry,
  aVoiceEntry,
  anEvent,
} from '../../../application/testing/builders'
import {
  FakeAudioTranscoder,
  fakeVoiceBytes,
  notARecording,
} from '../../../application/testing/fakeAudioTranscoder'
import { FakeContentHasher } from '../../../application/testing/fakeContentHasher'
import { FakeAuditLog } from '../../../application/testing/fakeAuditLog'
import { FakeGuestbookRepository } from '../../../application/testing/fakeGuestbookRepository'
import { FakeGuestbookVoiceRepository } from '../../../application/testing/fakeGuestbookVoiceRepository'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import { InMemoryMediaStore } from '../../../application/testing/inMemoryMediaStore'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import { makeCreateGuestbookEntry } from '../../../application/usecases/guestbook/createGuestbookEntry'
import { makeDeleteGuestbookEntry } from '../../../application/usecases/guestbook/deleteGuestbookEntry'
import { makeGetGuestbookVoiceMedia } from '../../../application/usecases/guestbook/getGuestbookVoiceMedia'
import { makeKeepPendingGuestbookVoices } from '../../../application/usecases/guestbook/keepPendingGuestbookVoices'
import { makeListMyGuestbookEntries } from '../../../application/usecases/guestbook/listMyGuestbookEntries'
import { makeOpenGuestbookVoice } from '../../../application/usecases/guestbook/openGuestbookVoice'
import { makeStageGuestbookVoice } from '../../../application/usecases/guestbook/stageGuestbookVoice'
import type { EventSettingsPatch } from '../../../domain/events/eventSettings'
import { VOICE_VARIANT } from '../../../domain/photos/mediaVariant'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { DomainError } from '../../../domain/shared/errors'
import { err } from '../../../domain/shared/result'

/**
 * The voice surface of the guestbook, through a real Express app with a real multer on real disk
 * (spec 25). Everything below the controller is production code over in-memory fakes, so what
 * these routes must respect is decided by the domain here exactly as it is in production. What only
 * this ring can answer is the wire: that a recording goes to disk and its temp file is gone
 * whatever happened, that a lie about the type is refused, that a `Range` request is a `206`, that
 * every way a recording is not there is one and the same `404`, and that the per-guest budget is
 * **one** instance shared with the written messages.
 */

const WEDDING = 'wedding-id'
const GALA = 'gala-id'
const OWNER = 'owner-id'
const MODERATOR = 'moderator-id'
const GALA_OWNER = 'gala-owner-id'
const STRANGER = 'stranger-id'
const GUEST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_GUEST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const GALA_GUEST = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

/** A ready voice with a file behind it, and ids that are uuids because they travel in a URL. */
const READY = '11111111-1111-4111-8111-111111111111'
const QUEUED = '22222222-2222-4222-8222-222222222222'
const FAILED = '33333333-3333-4333-8333-333333333333'
const GALA_READY = '44444444-4444-4444-8444-444444444444'
const WRITTEN = '55555555-5555-4555-8555-555555555555'
const TAKEN_DOWN = '66666666-6666-4666-8666-666666666666'
const UNKNOWN = '77777777-7777-4777-8777-777777777777'

const BASE = '/api/events/mariage'
const VOICE_ON: EventSettingsPatch = { allowGuestbook: true, guestbookVoice: { enabled: true } }
const AUDIO = new TextEncoder().encode('0123456789abcdefghij')

const aRecording = (seed = 'a', byteSize = 4_000): Buffer =>
  Buffer.from(fakeVoiceBytes({ audioMs: 5_000 + seed.charCodeAt(0), byteSize, container: 'mp4' }))

interface Subject {
  readonly harness: Harness
  readonly app: Express
  readonly guestbook: FakeGuestbookRepository
  readonly voices: FakeGuestbookVoiceRepository
  readonly media: InMemoryMediaStore
  readonly transcoder: FakeAudioTranscoder
  readonly audit: FakeAuditLog
  readonly tempDir: string
  readonly token: string
  readonly galaToken: string
}

interface SubjectOptions {
  readonly settings?: EventSettingsPatch
  readonly config?: Partial<HttpConfig>
  readonly transcoderUnavailable?: boolean
  /** A budget for the guestbook's per-guest limiter, built here once and handed to both routers. */
  readonly guestbookWritesPerGuestPerMinute?: number
  /** Gives the voice router a budget of its own, which is the defect the shared one prevents. */
  readonly separateGuestbookBudget?: boolean
}

let tempRoot: string

const buildSubject = (options: SubjectOptions = {}): Subject => {
  const guestbook = new FakeGuestbookRepository()
  const photos = new FakePhotoRepository()
  const voices = new FakeGuestbookVoiceRepository(guestbook).chargePhotoBytesFrom(photos)
  const media = new InMemoryMediaStore()
  const transcoder = new FakeAudioTranscoder()
  if (options.transcoderUnavailable === true) transcoder.unavailable()
  const audit = new FakeAuditLog().withAccounts(asUserId(OWNER), asUserId(MODERATOR))
  const ids = new SequentialIdGenerator()
  const tempDir = join(tempRoot, '.uploads')

  const shared = guestbookGuestLimiter(options.guestbookWritesPerGuestPerMinute ?? 6)

  const harness = buildHarness({
    ...(options.config === undefined ? {} : { config: options.config }),
    routes: (app, deps, world) => {
      app.post('/sign-in/owner', signInAs({ userId: OWNER, email: 'hote@example.test' }))
      app.post(
        '/sign-in/moderator',
        signInAs({ userId: MODERATOR, email: 'moderateur@example.test' }),
      )
      app.post('/sign-in/gala', signInAs({ userId: GALA_OWNER, email: 'gala@example.test' }))
      app.post('/sign-in/stranger', signInAs({ userId: STRANGER, email: 'inconnu@example.test' }))
      photos.chargeClientBytesFrom(world.clients)
      voices.chargeClientEventsFrom(world.clients)

      const invalidateExport = async (): Promise<void> => {}
      const usecases = {
        stageGuestbookVoice: makeStageGuestbookVoice({
          events: deps.events,
          clients: world.clients,
          guestbook,
          voices,
          media,
          transcoder,
          hasher: new FakeContentHasher(),
          bus: deps.bus,
          clock: deps.clock,
          ids,
          logger: deps.logger,
          limits: { maxQueuedVoices: 40, maxQueuedVoicesPerEvent: 20 },
        }),
        getGuestbookVoiceMedia: makeGetGuestbookVoiceMedia({
          events: deps.events,
          guestbook,
          memberships: deps.memberships,
          media,
          clock: deps.clock,
        }),
        openGuestbookVoice: makeOpenGuestbookVoice({
          events: deps.events,
          memberships: deps.memberships,
          audit,
          bus: deps.bus,
          clock: deps.clock,
          invalidateExport,
        }),
        keepPendingGuestbookVoices: makeKeepPendingGuestbookVoices({
          events: deps.events,
          guestbook,
          memberships: deps.memberships,
          audit,
          bus: deps.bus,
          clock: deps.clock,
          invalidateExport,
        }),
      }
      app.use(
        '/api',
        guestbookRoutes({
          deps,
          guestbookGuestRateLimiter: shared,
          usecases: {
            createGuestbookEntry: makeCreateGuestbookEntry({
              events: deps.events,
              guestbook,
              ids,
              bus: deps.bus,
              clock: deps.clock,
            }),
            listMyGuestbookEntries: makeListMyGuestbookEntries({
              events: deps.events,
              guestbook,
              transcoder,
              clock: deps.clock,
              voiceMaxDurationMs: 60_000,
            }),
            deleteGuestbookEntry: makeDeleteGuestbookEntry({
              events: deps.events,
              guestbook,
              voices,
              media,
              bus: deps.bus,
              clock: deps.clock,
            }),
            listGuestbookQueue: async () => err(DomainError.unexpected('test.useCaseNotWired')),
            moderateGuestbookEntry: async () => err(DomainError.unexpected('test.useCaseNotWired')),
          },
        }),
      )
      app.use(
        '/api',
        guestbookVoiceRoutes({
          deps,
          usecases,
          uploadTempDir: tempDir,
          maxVoiceBytes: deps.config.voice.maxBytes,
          ...(options.separateGuestbookBudget === true
            ? { guestbookGuestRateLimiter: guestbookGuestLimiter(6) }
            : { guestbookGuestRateLimiter: shared }),
        }),
      )
    },
  })

  harness.events.seed(
    anEvent({
      id: WEDDING,
      slug: 'mariage',
      joinCode: 'H7K2QM',
      ownerId: OWNER,
      settings: { ...VOICE_ON, ...options.settings },
    }),
    anEvent({ id: GALA, slug: 'gala', joinCode: 'B4N9PT', ownerId: GALA_OWNER }),
  )
  harness.memberships.seed(
    { eventId: asEventId(WEDDING), userId: asUserId(OWNER), role: 'owner', grantedAt: AT },
    { eventId: asEventId(WEDDING), userId: asUserId(MODERATOR), role: 'moderator', grantedAt: AT },
    { eventId: asEventId(GALA), userId: asUserId(GALA_OWNER), role: 'owner', grantedAt: AT },
  )
  harness.guests.seed(
    aGuest({ id: GUEST, eventId: WEDDING, displayName: 'Léa' }),
    aGuest({ id: OTHER_GUEST, eventId: WEDDING, displayName: 'Sacha' }),
    aGuest({ id: GALA_GUEST, eventId: GALA, displayName: 'Sam' }),
  )

  return {
    harness,
    app: harness.app,
    guestbook,
    voices,
    media,
    transcoder,
    audit,
    tempDir,
    token: harness.issueGuestToken(WEDDING, GUEST),
    galaToken: harness.issueGuestToken(GALA, GALA_GUEST),
  }
}

const cookie = (token: string): string => `${GUEST_COOKIE}=${token}`

const signedIn = async (subject: Subject, who: 'owner' | 'moderator' | 'gala' | 'stranger') => {
  const agent = request.agent(subject.app)
  await agent.post(`/sign-in/${who}`).expect(204)
  return agent
}

/** A voice with its file in the store, so a listener is served it. */
const seedReady = async (
  subject: Subject,
  input: Parameters<typeof aVoiceEntry>[0] = {},
): Promise<void> => {
  const entry = aVoiceEntry({ id: READY, state: 'ready', eventId: WEDDING, ...input })
  subject.guestbook.seed(entry)
  const hash = entry.voice?.audioHash
  if (hash !== null && hash !== undefined) {
    await subject.media.put(asEventId(entry.eventId), hash, VOICE_VARIANT, AUDIO)
  }
}

const sendVoice = (subject: Subject, bytes: Buffer = aRecording(), name = 'voice.m4a') =>
  request(subject.app)
    .post(`${BASE}/guestbook/voice`)
    .set('Cookie', cookie(subject.token))
    .attach('voice', bytes, name)

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'eventslide-voiceroutes-'))
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

const leftOnDisk = async (subject: Subject): Promise<string[]> =>
  readdir(subject.tempDir).catch(() => [])

describe('POST /api/events/:eventSlug/guestbook/voice', () => {
  it('accepts a recording and answers 202 with the entry, queued, and nothing heard yet', async () => {
    const subject = buildSubject()

    const response = await sendVoice(subject)

    expect(response.status).toBe(202)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toEqual({
      entry: {
        id: expect.any(String),
        text: null,
        status: 'pending',
        createdAt: AT.toISOString(),
        duplicate: false,
        voice: { state: 'queued', durationMs: null, caption: null },
      },
    })
  })

  it('wakes the worker and tells no screen: voice.queued is the only fact, and it is a moderation-only one', async () => {
    const subject = buildSubject()

    await sendVoice(subject)

    expect(subject.harness.bus.published.map((fact) => fact.type)).toEqual(['voice.queued'])
  })

  it('takes the author from the device token, never from the request', async () => {
    const subject = buildSubject()

    await sendVoice(subject)

    const stored = (
      await subject.guestbook.listByGuest(asEventId(WEDDING), aGuest({ id: GUEST }).id, 10)
    )[0]
    expect(stored?.guestId).toBe(GUEST)
    expect(stored?.eventId).toBe(WEDDING)
  })

  it('carries the caption through', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .post(`${BASE}/guestbook/voice`)
      .set('Cookie', cookie(subject.token))
      .field('caption', 'Pour Camille')
      .attach('voice', aRecording(), 'voice.m4a')

    expect(response.status).toBe(202)
    expect(response.body.entry.voice.caption).toBe('Pour Camille')
  })

  it('answers the same entry for the same recording sent again, flagged, with no second signal', async () => {
    const subject = buildSubject()
    const first = await sendVoice(subject, aRecording('a'))

    const again = await sendVoice(subject, aRecording('a'))

    expect(again.status).toBe(202)
    expect(again.body.entry.id).toBe(first.body.entry.id)
    expect(again.body.entry.duplicate).toBe(true)
    expect(
      subject.harness.bus.published.filter((fact) => fact.type === 'voice.queued'),
    ).toHaveLength(1)
  })

  describe('what is refused, and what it costs', () => {
    it('refuses a file of another type that lies about being audio/mp4, before any byte is stored', async () => {
      const subject = buildSubject()

      const response = await request(subject.app)
        .post(`${BASE}/guestbook/voice`)
        .set('Cookie', cookie(subject.token))
        .attach('voice', Buffer.from(notARecording()), {
          filename: 'voice.m4a',
          contentType: 'audio/mp4',
        })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('voice.unsupportedFormat')
      expect(subject.guestbook.all(asEventId(WEDDING))).toEqual([])
      expect(subject.media.objectCount).toBe(0)
    })

    it('answers 413 for a recording over the ceiling, which multer stops before the use case', async () => {
      const subject = buildSubject({
        config: { voice: { maxBytes: 5_000, uploadTempDir: join(tempRoot, '.uploads') } },
      })

      const response = await sendVoice(subject, aRecording('a', 5_001))

      expect(response.status).toBe(413)
      expect(response.body.error.code).toBe('upload.tooLarge')
      expect(subject.guestbook.all(asEventId(WEDDING))).toEqual([])
    })

    it('answers 400 upload.noFiles when no file came at all', async () => {
      const subject = buildSubject()

      const response = await request(subject.app)
        .post(`${BASE}/guestbook/voice`)
        .set('Cookie', cookie(subject.token))
        .field('caption', 'Pour Camille')

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('upload.noFiles')
    })

    it('answers 400 for a file under another field name', async () => {
      const subject = buildSubject()

      const response = await request(subject.app)
        .post(`${BASE}/guestbook/voice`)
        .set('Cookie', cookie(subject.token))
        .attach('clip', aRecording(), 'voice.m4a')

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('upload.unexpectedField')
    })

    it('answers 400 request.invalid for a text part that is not the caption: nothing a phone says about its recording is believed', async () => {
      const subject = buildSubject()

      const response = await request(subject.app)
        .post(`${BASE}/guestbook/voice`)
        .set('Cookie', cookie(subject.token))
        .field('durationMs', '1000')
        .attach('voice', aRecording(), 'voice.m4a')

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('request.invalid')
      expect(subject.guestbook.all(asEventId(WEDDING))).toEqual([])
    })

    it('answers 409 guestbook.voiceDisabled when the host has not switched the voice on', async () => {
      const subject = buildSubject({ settings: { guestbookVoice: { enabled: false } } })

      const response = await sendVoice(subject)

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('guestbook.voiceDisabled')
    })

    it('answers 409 guestbook.limitReached once the guest holds three lines, text or voice', async () => {
      const subject = buildSubject()
      subject.guestbook.seed(
        aGuestbookEntry({ id: 'w1', eventId: WEDDING, guestId: GUEST, text: 'un' }),
        aGuestbookEntry({ id: 'w2', eventId: WEDDING, guestId: GUEST, text: 'deux' }),
        aGuestbookEntry({ id: 'w3', eventId: WEDDING, guestId: GUEST, text: 'trois' }),
      )

      const response = await sendVoice(subject)

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('guestbook.limitReached')
    })

    it('answers 500 voice.transcoderUnavailable on a box with no encoder, before a byte is written', async () => {
      const subject = buildSubject({ transcoderUnavailable: true })

      const response = await sendVoice(subject)

      expect(response.status).toBe(500)
      expect(response.body.error.code).toBe('voice.transcoderUnavailable')
      expect(subject.media.objectCount).toBe(0)
    })

    it('answers 413 storage.boxFull when the free-disk-space guard reports insufficient room', async () => {
      const subject = buildSubject()
      subject.harness.diskSpaceChecker.set('/media', 0)

      const response = await sendVoice(subject)

      expect(response.status).toBe(413)
      expect(response.body.error.code).toBe('storage.boxFull')
    })

    it('removes its temp file on every exit: the answer, the refusal and the thrown error', async () => {
      const subject = buildSubject()

      await sendVoice(subject)
      await sendVoice(subject, Buffer.from(notARecording()))
      await request(subject.app)
        .post(`${BASE}/guestbook/voice`)
        .set('Cookie', cookie(subject.token))
        .field('durationMs', '1000')
        .attach('voice', aRecording('c'), 'voice.m4a')

      expect(await leftOnDisk(subject)).toEqual([])
    })
  })

  describe('who may send', () => {
    it('answers 401 without a device token, and takes no upload slot', async () => {
      const subject = buildSubject({
        config: {
          uploads: {
            maxBytes: 25_000_000,
            maxFiles: 20,
            maxConcurrentRequests: 0,
            maxConcurrentRequestsPerEvent: 1_000,
            bodyTimeoutMs: 600_000,
          },
        },
      })

      const response = await request(subject.app)
        .post(`${BASE}/guestbook/voice`)
        .attach('voice', aRecording(), 'voice.m4a')

      expect(response.status).toBe(401)
      expect(response.body.error.code).toBe('auth.required')
    })

    it('answers 429 upload.busy once the shared concurrency cap is reached: the route is behind the semaphore', async () => {
      const subject = buildSubject({
        config: {
          uploads: {
            maxBytes: 25_000_000,
            maxFiles: 20,
            maxConcurrentRequests: 0,
            maxConcurrentRequestsPerEvent: 1_000,
            bodyTimeoutMs: 600_000,
          },
        },
      })

      const response = await sendVoice(subject)

      expect(response.status).toBe(429)
      expect(response.body.error.code).toBe('upload.busy')
    })

    it('refuses a token of another event: the guest of the gala has no place in the wedding’s book', async () => {
      const subject = buildSubject()

      const response = await request(subject.app)
        .post(`${BASE}/guestbook/voice`)
        .set('Cookie', cookie(subject.galaToken))
        .attach('voice', aRecording(), 'voice.m4a')

      // The event of the URL is the wedding, and a token of the gala names another: not there.
      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('event.notFound')
      expect(subject.guestbook.all(asEventId(WEDDING))).toEqual([])
    })

    it('answers 404 event.notFound for an event nobody holds', async () => {
      const subject = buildSubject()

      const response = await request(subject.app)
        .post('/api/events/nulle-part/guestbook/voice')
        .set('Cookie', cookie(subject.token))
        .attach('voice', aRecording(), 'voice.m4a')

      expect(response.status).toBe(404)
      expect(subject.guestbook.all(asEventId(WEDDING))).toEqual([])
    })
  })

  describe('the limiters', () => {
    it('sits behind the upload bucket by address and event: a second request is refused before its token is read', async () => {
      const subject = buildSubject({
        config: {
          rateLimits: { ...testHttpConfig().rateLimits, uploadPerIpPerMinute: 1 },
        },
      })

      const first = await request(subject.app)
        .post(`${BASE}/guestbook/voice`)
        .attach('voice', aRecording(), 'voice.m4a')
      const second = await request(subject.app)
        .post(`${BASE}/guestbook/voice`)
        .attach('voice', aRecording(), 'voice.m4a')

      expect(first.status).toBe(401)
      expect(second.status).toBe(429)
      expect(second.body.error.code).toBe('rate.limited')
    })

    it('sits behind the per-guest upload budget, shared with photographs and clips: the guest’s second recording of the minute is refused', async () => {
      const subject = buildSubject({
        config: { rateLimits: { ...testHttpConfig().rateLimits, uploadPerMinute: 1 } },
      })

      const first = await sendVoice(subject, aRecording('a'))
      const second = await sendVoice(subject, aRecording('b'))
      const other = await request(subject.app)
        .post(`${BASE}/guestbook/voice`)
        .set('Cookie', cookie(subject.harness.issueGuestToken(WEDDING, OTHER_GUEST)))
        .attach('voice', aRecording('c'), 'voice.m4a')

      expect([first.status, second.status, other.status]).toEqual([202, 429, 202])
      expect(second.body.error.code).toBe('rate.limited')
    })

    it('spends the guestbook’s per-guest budget with the written messages: one guest, one budget', async () => {
      const subject = buildSubject({ guestbookWritesPerGuestPerMinute: 3 })
      const write = (text: string) =>
        request(subject.app)
          .post(`${BASE}/guestbook`)
          .set('Cookie', cookie(subject.token))
          .send({ text })

      expect((await write('un')).status).toBe(201)
      expect((await write('deux')).status).toBe(201)
      expect((await sendVoice(subject)).status).toBe(202)

      const refused = await sendVoice(subject, aRecording('b'))

      expect(refused.status).toBe(429)
      expect(refused.body.error.code).toBe('rate.limited')
    })

    it('is spent the other way round as well: a voice and a taking-back leave a message nothing to spend', async () => {
      const subject = buildSubject({ guestbookWritesPerGuestPerMinute: 2 })
      const sent = await sendVoice(subject)
      expect(sent.status).toBe(202)
      const takeBack = await request(subject.app)
        .delete(`${BASE}/guestbook/${sent.body.entry.id}`)
        .set('Cookie', cookie(subject.token))
      expect(takeBack.status).not.toBe(429)

      const refused = await request(subject.app)
        .post(`${BASE}/guestbook`)
        .set('Cookie', cookie(subject.token))
        .send({ text: 'un mot' })

      expect(refused.status).toBe(429)
    })

    it('would be two budgets if the voice router built its own, which is the defect the injected one prevents', async () => {
      const subject = buildSubject({
        guestbookWritesPerGuestPerMinute: 1,
        separateGuestbookBudget: true,
      })
      await request(subject.app)
        .post(`${BASE}/guestbook`)
        .set('Cookie', cookie(subject.token))
        .send({ text: 'un mot' })

      const voice = await sendVoice(subject)

      // With the shared instance this is the 429 above; with two it sails through.
      expect(voice.status).toBe(202)
    })

    it('is one guest’s budget and no one else’s: the other guest of the room still writes', async () => {
      const subject = buildSubject({ guestbookWritesPerGuestPerMinute: 1 })
      await sendVoice(subject)
      expect((await sendVoice(subject, aRecording('b'))).status).toBe(429)

      const other = await request(subject.app)
        .post(`${BASE}/guestbook/voice`)
        .set('Cookie', cookie(subject.harness.issueGuestToken(WEDDING, OTHER_GUEST)))
        .attach('voice', aRecording('c'), 'voice.m4a')

      expect(other.status).toBe(202)
    })
  })
})

describe('GET /api/events/:eventSlug/guestbook/mine, for a voice message', () => {
  it('lists the guest’s recording with its state and duration, and says whether the button is offered', async () => {
    const subject = buildSubject()
    await seedReady(subject, { guestId: GUEST, caption: 'Pour Camille' })

    const response = await request(subject.app)
      .get(`${BASE}/guestbook/mine`)
      .set('Cookie', cookie(subject.token))

    expect(response.status).toBe(200)
    expect(response.body.voiceAvailable).toBe(true)
    expect(response.body.voiceMaxSeconds).toBe(60)
    expect(response.body.items[0]).toMatchObject({
      id: READY,
      text: null,
      voice: { state: 'ready', durationMs: 12_000, caption: 'Pour Camille' },
    })
  })

  it('never carries a digest, a path or the size of the recording', async () => {
    const subject = buildSubject()
    await seedReady(subject, { guestId: GUEST })

    const response = await request(subject.app)
      .get(`${BASE}/guestbook/mine`)
      .set('Cookie', cookie(subject.token))

    expect(JSON.stringify(response.body)).not.toMatch(/hash|path|bytes|audio/i)
  })

  it('says the button is not offered on a box with no encoder', async () => {
    const subject = buildSubject({ transcoderUnavailable: true })

    const response = await request(subject.app)
      .get(`${BASE}/guestbook/mine`)
      .set('Cookie', cookie(subject.token))

    expect(response.body.voiceAvailable).toBe(false)
  })
})

describe('GET /api/events/:eventSlug/guestbook/:entryId/voice', () => {
  const listen = (subject: Subject, id = READY, headers: Record<string, string> = {}) =>
    signedIn(subject, 'moderator').then((agent) => {
      let call = agent.get(`${BASE}/guestbook/${id}/voice`)
      for (const [name, value] of Object.entries(headers)) call = call.set(name, value)
      return call.buffer(true).parse((res, done) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const body = Buffer.concat(chunks)
          // A refusal is the JSON error every route sends; only the recording itself is bytes.
          done(
            null,
            String(res.headers['content-type']).includes('json')
              ? JSON.parse(body.toString())
              : body,
          )
        })
      })
    })

  it('serves a moderator the recording: audio/mp4, nosniff, and a way to ask for a range', async () => {
    const subject = buildSubject()
    await seedReady(subject)

    const response = await listen(subject)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('audio/mp4')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['accept-ranges']).toBe('bytes')
    expect(Buffer.from(response.body as Buffer).equals(Buffer.from(AUDIO))).toBe(true)
  })

  it('is private and revalidated, never stored: Cache-Control private, no-cache with a strong ETag', async () => {
    const subject = buildSubject()
    await seedReady(subject)

    const response = await listen(subject)

    expect(response.headers['cache-control']).toBe('private, no-cache')
    expect(response.headers['etag']).toMatch(/^"[0-9a-f]{64}"$/)
  })

  it('answers 206 with the part, its place in the whole and its own length, as Safari needs', async () => {
    const subject = buildSubject()
    await seedReady(subject)

    const response = await listen(subject, READY, { Range: 'bytes=2-5' })

    expect(response.status).toBe(206)
    expect(response.headers['content-range']).toBe(`bytes 2-5/${AUDIO.length}`)
    expect(response.headers['content-length']).toBe('4')
    expect(response.headers['accept-ranges']).toBe('bytes')
    expect(Buffer.from(response.body as Buffer).toString()).toBe('2345')
  })

  it('answers 304 to a revalidation, with no body and the validator and the policy still on it', async () => {
    const subject = buildSubject()
    await seedReady(subject)
    const first = await listen(subject)

    const second = await listen(subject, READY, {
      'If-None-Match': String(first.headers['etag']),
    })

    expect(second.status).toBe(304)
    expect(second.headers['cache-control']).toBe('private, no-cache')
    expect(second.headers['etag']).toBe(first.headers['etag'])
  })

  it('answers 416 for a range beyond the recording, with the size a player needs to correct itself', async () => {
    const subject = buildSubject()
    await seedReady(subject)

    const response = await listen(subject, READY, { Range: 'bytes=900-999' })

    expect(response.status).toBe(416)
    expect(response.headers['content-range']).toBe(`bytes */${AUDIO.length}`)
  })

  describe('the sealed secret', () => {
    it('is 403 guestbook.voiceSealed to a moderator and to the owner, with nothing stored', async () => {
      const subject = buildSubject({
        settings: { guestbookVoice: { enabled: true, sealed: true } },
      })
      await seedReady(subject)

      const moderator = await listen(subject)
      const owner = await (await signedIn(subject, 'owner')).get(`${BASE}/guestbook/${READY}/voice`)

      expect(moderator.status).toBe(403)
      expect(owner.status).toBe(403)
      expect(owner.body.error.code).toBe('guestbook.voiceSealed')
      expect(owner.headers['cache-control']).toBe('no-store')
      expect(owner.headers['x-content-type-options']).toBe('nosniff')
    })
  })

  describe('one refusal for everything that is not there to be heard', () => {
    const answer = (response: { status: number; body: unknown }) => ({
      status: response.status,
      body: JSON.parse(JSON.stringify(response.body)) as unknown,
    })

    it('is the same 404 guestbook.notFound for an unknown id, another event’s, a retired one, a written one and one not ready', async () => {
      const subject = buildSubject()
      await seedReady(subject)
      subject.harness.events.seed(
        anEvent({ id: GALA, slug: 'gala', joinCode: 'B4N9PT', ownerId: GALA_OWNER }),
      )
      await seedReady(subject, { id: GALA_READY, eventId: GALA, sourceHash: 'e'.repeat(64) })
      await seedReady(subject, { id: TAKEN_DOWN, sourceHash: 'd'.repeat(64) })
      subject.guestbook.takeDown(asEventId(WEDDING), aGuestbookEntry({ id: TAKEN_DOWN }).id, AT)
      subject.guestbook.seed(
        aVoiceEntry({ id: QUEUED, state: 'queued', eventId: WEDDING, sourceHash: 'a'.repeat(64) }),
        aVoiceEntry({ id: FAILED, state: 'failed', eventId: WEDDING, sourceHash: 'b'.repeat(64) }),
        aGuestbookEntry({ id: WRITTEN, eventId: WEDDING }),
      )

      const answers = []
      for (const id of [UNKNOWN, GALA_READY, TAKEN_DOWN, WRITTEN, QUEUED, FAILED]) {
        answers.push(answer(await listen(subject, id)))
      }

      expect(answers[0]).toEqual({
        status: 404,
        body: { error: { code: 'guestbook.notFound', message: expect.any(String), details: {} } },
      })
      for (const each of answers) expect(each).toEqual(answers[0])
    })
  })

  describe('who may listen', () => {
    it('refuses a guest’s device token: a guest is not a session, whoever the author is', async () => {
      const subject = buildSubject()
      await seedReady(subject, { guestId: GUEST })

      const response = await request(subject.app)
        .get(`${BASE}/guestbook/${READY}/voice`)
        .set('Cookie', cookie(subject.token))

      expect(response.status).toBe(401)
      expect(response.headers['content-type']).not.toBe('audio/mp4')
    })

    it('answers 401 without a session', async () => {
      const subject = buildSubject()
      await seedReady(subject)

      const response = await request(subject.app).get(`${BASE}/guestbook/${READY}/voice`)

      expect(response.status).toBe(401)
      expect(response.body.error.code).toBe('auth.required')
    })

    it('answers 404 event.notFound, never 403, to the host of another event', async () => {
      const subject = buildSubject()
      await seedReady(subject)

      const response = await (
        await signedIn(subject, 'gala')
      ).get(`${BASE}/guestbook/${READY}/voice`)

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('event.notFound')
    })

    it('answers 400 for an id that is not an id', async () => {
      const subject = buildSubject()

      const response = await (
        await signedIn(subject, 'moderator')
      ).get(`${BASE}/guestbook/not-an-id/voice`)

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('request.invalid')
    })
  })
})

describe('POST /api/events/:eventSlug/guestbook/voice/open', () => {
  const sealed: EventSettingsPatch = { guestbookVoice: { enabled: true, sealed: true } }
  const open = (agent: Awaited<ReturnType<typeof signedIn>>) =>
    agent.post(`${BASE}/guestbook/voice/open`)

  it('lifts the secret for the owner: 200, no body, and the recording can then be heard', async () => {
    const subject = buildSubject({ settings: sealed })
    await seedReady(subject)

    const response = await open(await signedIn(subject, 'owner'))

    expect(response.status).toBe(200)
    expect(response.text).toBe('')
    const heard = await (
      await signedIn(subject, 'moderator')
    ).get(`${BASE}/guestbook/${READY}/voice`)
    expect(heard.status).toBe(200)
  })

  it('is idempotent: the second call is the same 200, and leaves one audit line', async () => {
    const subject = buildSubject({ settings: sealed })
    const owner = await signedIn(subject, 'owner')

    expect((await open(owner)).status).toBe(200)
    expect((await open(owner)).status).toBe(200)

    expect(subject.audit.all().map((line) => line.action)).toEqual(['event.voiceOpened'])
  })

  it('is refused to a moderator with 403 auth.forbidden, and the secret holds', async () => {
    const subject = buildSubject({ settings: sealed })
    await seedReady(subject)

    const response = await open(await signedIn(subject, 'moderator'))

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('auth.forbidden')
    expect(
      (await (await signedIn(subject, 'owner')).get(`${BASE}/guestbook/${READY}/voice`)).status,
    ).toBe(403)
  })

  it('answers 401 to a guest’s device token and without a session', async () => {
    const subject = buildSubject({ settings: sealed })

    const guest = await request(subject.app)
      .post(`${BASE}/guestbook/voice/open`)
      .set('Cookie', cookie(subject.token))
    const anonymous = await request(subject.app).post(`${BASE}/guestbook/voice/open`)

    expect(guest.status).toBe(401)
    expect(anonymous.status).toBe(401)
  })

  it('answers 404 to the host of another event, and to a signed-in stranger', async () => {
    const subject = buildSubject({ settings: sealed })

    expect((await open(await signedIn(subject, 'gala'))).status).toBe(404)
    expect((await open(await signedIn(subject, 'stranger'))).status).toBe(404)
  })
})

describe('POST /api/events/:eventSlug/guestbook/voice/keep-pending', () => {
  const keep = (agent: Awaited<ReturnType<typeof signedIn>>) =>
    agent.post(`${BASE}/guestbook/voice/keep-pending`)

  it('publishes the ready voices that wait and answers how many', async () => {
    const subject = buildSubject()
    subject.guestbook.seed(
      aVoiceEntry({ id: READY, state: 'ready', eventId: WEDDING }),
      aVoiceEntry({ id: QUEUED, state: 'queued', eventId: WEDDING, sourceHash: 'a'.repeat(64) }),
    )

    const response = await keep(await signedIn(subject, 'moderator'))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ kept: 1 })
    expect(response.headers['cache-control']).toBe('no-store')
    expect(
      (await subject.guestbook.findById(asEventId(WEDDING), aGuestbookEntry({ id: READY }).id))
        ?.status,
    ).toBe('published')
    expect(
      (await subject.guestbook.findById(asEventId(WEDDING), aGuestbookEntry({ id: QUEUED }).id))
        ?.status,
    ).toBe('pending')
  })

  it('answers 0 when there is nothing to keep, without a word in the audit log', async () => {
    const subject = buildSubject()

    const response = await keep(await signedIn(subject, 'owner'))

    expect(response.body).toEqual({ kept: 0 })
    expect(subject.audit.all()).toEqual([])
  })

  it('answers 401 to a guest’s device token and without a session', async () => {
    const subject = buildSubject()

    expect(
      (
        await request(subject.app)
          .post(`${BASE}/guestbook/voice/keep-pending`)
          .set('Cookie', cookie(subject.token))
      ).status,
    ).toBe(401)
    expect((await request(subject.app).post(`${BASE}/guestbook/voice/keep-pending`)).status).toBe(
      401,
    )
  })

  it('answers 404 to the host of another event, and to a signed-in stranger', async () => {
    const subject = buildSubject()

    expect((await keep(await signedIn(subject, 'gala'))).status).toBe(404)
    expect((await keep(await signedIn(subject, 'stranger'))).status).toBe(404)
  })
})
