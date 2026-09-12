import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Express } from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clipRoutes, clipUploadTempDir, withGuestClip } from './clipRoutes'
import { GUEST_COOKIE } from '../middleware/authz'
import { buildHarness, type Harness } from '../testing/middlewareHarness'
import { AT, aClipJob, aGuest, anEvent } from '../../../application/testing/builders'
import { FakeClipJobRepository } from '../../../application/testing/fakeClipJobRepository'
import { FakePhotoRepository } from '../../../application/testing/fakePhotoRepository'
import {
  FakeVideoTranscoder,
  fakeClipBytes,
} from '../../../application/testing/fakeVideoTranscoder'
import { InMemoryMediaStore } from '../../../application/testing/inMemoryMediaStore'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import { makeGetClipJob } from '../../../application/usecases/clips/getClipJob'
import { makeUploadClip } from '../../../application/usecases/clips/uploadClip'
import type { ContentHasher } from '../../../application/ports/contentHasher'
import type { EventSettingsPatch } from '../../../domain/events/eventSettings'
import { asEventId } from '../../../domain/shared/ids'

/**
 * The clip surface, through a real Express app with a real multer on real disk.
 *
 * Everything below the controller is the production code path: the use cases are the
 * real ones over in-memory fakes, so the rules these routes must respect are decided by
 * the domain here exactly as they are in production. What only this ring can answer is
 * the wire: that a clip goes to **disk** and not to the heap, that the temp file is gone
 * whatever happened, that a full queue is a `429` with a `Retry-After` and never the
 * quota's `413`, and that a guest cannot poll another guest's clip.
 */

const WEDDING = 'wedding-id'
const GALA = 'gala-id'
const GUEST = 'guest-1'
const OTHER_GUEST = 'guest-2'

const BASE = '/api/events/mariage'

/** A digest of the bytes, so the same upload twice collides as it would in production. */
const hasher: ContentHasher = {
  sha256Hex: (bytes: Uint8Array): string => {
    let state = 2166136261
    let digest = ''
    while (digest.length < 64) {
      for (const byte of bytes) state = Math.imul(state ^ byte, 16777619) >>> 0
      state = Math.imul(state ^ digest.length, 16777619) >>> 0
      digest += state.toString(16).padStart(8, '0')
    }
    return digest.slice(0, 64)
  },
}

const aClipBody = (seed = 'one', byteSize = 200_000): Buffer =>
  Buffer.from(
    fakeClipBytes({ width: 1920, height: 1080, durationMs: 9_000, byteSize }).map((byte, index) =>
      index === 40 ? seed.charCodeAt(0) : byte,
    ),
  )

interface Subject {
  readonly harness: Harness
  readonly app: Express
  readonly clips: FakeClipJobRepository
  readonly photos: FakePhotoRepository
  readonly media: InMemoryMediaStore
  readonly tempDir: string
  readonly token: string
  readonly galaToken: string
}

interface SubjectOptions {
  readonly settings?: EventSettingsPatch
  readonly maxQueuedClips?: number
  readonly maxClipBytes?: number
  readonly quotaBytes?: number
}

let tempRoot: string

const buildSubject = (options: SubjectOptions = {}): Subject => {
  const clips = new FakeClipJobRepository()
  const photos = new FakePhotoRepository().chargeStagedBytesFrom(clips)
  const media = new InMemoryMediaStore()
  const ids = new SequentialIdGenerator()
  const transcoder = new FakeVideoTranscoder()
  // Under a per-test directory, standing in for MEDIA_ROOT — never `os.tmpdir()` in
  // production, because the container is read-only with a tmpfs on the memory cgroup.
  const tempDir = clipUploadTempDir(tempRoot)

  const harness = buildHarness({
    routes: (app, deps) => {
      app.use(
        '/api',
        clipRoutes({
          deps,
          uploadTempDir: tempDir,
          maxClipBytes: options.maxClipBytes ?? 5_000_000,
          usecases: {
            uploadClip: makeUploadClip({
              events: deps.events,
              clips,
              photos,
              media,
              transcoder,
              hasher,
              bus: deps.bus,
              clock: deps.clock,
              ids,
              logger: deps.logger,
              limits: { maxQueuedClips: options.maxQueuedClips ?? 20 },
            }),
            getClipJob: makeGetClipJob({ clips }),
          },
        }),
      )
    },
  })

  harness.events.seed(
    anEvent({
      id: WEDDING,
      slug: 'mariage',
      joinCode: 'H7K2QM',
      ...(options.quotaBytes === undefined ? {} : { quotaBytes: options.quotaBytes }),
      ...(options.settings === undefined ? {} : { settings: options.settings }),
    }),
    anEvent({ id: GALA, slug: 'gala', joinCode: 'B4N9PT' }),
  )
  harness.guests.seed(
    aGuest({ id: GUEST, eventId: WEDDING, displayName: 'Léa' }),
    aGuest({ id: OTHER_GUEST, eventId: WEDDING, displayName: 'Sacha' }),
  )

  return {
    harness,
    app: harness.app,
    clips,
    photos,
    media,
    tempDir,
    token: harness.issueGuestToken(WEDDING, GUEST),
    galaToken: harness.issueGuestToken(GALA, GUEST),
  }
}

const cookie = (token: string): string => `${GUEST_COOKIE}=${token}`

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'eventslide-cliproutes-'))
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('POST /api/events/:eventSlug/clips', () => {
  it('accepts a clip and answers 202 with the job to watch', async () => {
    // 202, not 201: nothing exists that a moderator could act on. A clip that is still
    // transcoding has no `photos` row at all.
    const subject = buildSubject()

    const response = await request(subject.app)
      .post(`${BASE}/clips`)
      .set('Cookie', cookie(subject.token))
      .attach('clip', aClipBody(), 'IMG_4021.MOV')

    expect(response.status).toBe(202)
    expect(response.body).toEqual({
      clipJobId: 'clip-job-1',
      status: 'queued',
      photoId: 'photo-1',
      failureCode: null,
    })
  })

  it('creates no photo row, which is the whole point of the queue', async () => {
    const subject = buildSubject()

    await request(subject.app)
      .post(`${BASE}/clips`)
      .set('Cookie', cookie(subject.token))
      .attach('clip', aClipBody(), 'IMG_4021.MOV')

    expect((await subject.photos.list(asEventId(WEDDING))).items).toEqual([])
  })

  it('carries the caption through the queue', async () => {
    const subject = buildSubject()

    await request(subject.app)
      .post(`${BASE}/clips`)
      .set('Cookie', cookie(subject.token))
      .field('caption', 'Le premier slow')
      .attach('clip', aClipBody(), 'IMG_4021.MOV')

    expect(subject.clips.all[0]?.caption?.value).toBe('Le premier slow')
  })

  it('leaves no temp file behind, on the path that works', async () => {
    // Disk storage means every exit path owns a file, and "cleanup on every exit path"
    // is exactly what 1.0 leaked.
    const subject = buildSubject()

    await request(subject.app)
      .post(`${BASE}/clips`)
      .set('Cookie', cookie(subject.token))
      .attach('clip', aClipBody(), 'IMG_4021.MOV')

    expect(await readdir(subject.tempDir)).toEqual([])
  })

  it('leaves no temp file behind on the path that refuses', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .post(`${BASE}/clips`)
      .set('Cookie', cookie(subject.token))
      .attach('clip', Buffer.from('%PDF-1.7 not a clip at all'), 'invoice.pdf')

    expect(response.status).toBe(400)
    expect(await readdir(subject.tempDir)).toEqual([])
  })

  it('refuses a file that is not a video, from its signature', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .post(`${BASE}/clips`)
      .set('Cookie', cookie(subject.token))
      .attach('clip', Buffer.from('%PDF-1.7 not a clip at all'), 'clip.mp4')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('clip.unsupportedFormat')
  })

  it('refuses a request that carried no file at all', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .post(`${BASE}/clips`)
      .set('Cookie', cookie(subject.token))
      .field('caption', 'nothing attached')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('upload.noFiles')
  })

  it('refuses a clip larger than the clip limit', async () => {
    // A limit of its own. Raising `MAX_UPLOAD_BYTES` instead would raise the per-request
    // heap ceiling `guestRoutes.ts` derives from it.
    const subject = buildSubject({ maxClipBytes: 1_000 })

    const response = await request(subject.app)
      .post(`${BASE}/clips`)
      .set('Cookie', cookie(subject.token))
      .attach('clip', aClipBody('one', 50_000), 'IMG_4021.MOV')

    expect(response.status).toBe(413)
    expect(subject.clips.all).toEqual([])
  })

  it('refuses a second file in one request', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .post(`${BASE}/clips`)
      .set('Cookie', cookie(subject.token))
      .attach('clip', aClipBody('one'), 'one.mov')
      .attach('clip', aClipBody('two'), 'two.mov')

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(subject.clips.all).toEqual([])
  })

  it('refuses a file sent under a field name this route does not accept', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .post(`${BASE}/clips`)
      .set('Cookie', cookie(subject.token))
      .attach('photos', aClipBody(), 'IMG_4021.MOV')

    expect(response.status).toBeGreaterThanOrEqual(400)
  })

  describe('backpressure', () => {
    it('answers a full queue with 429 and a Retry-After, never the quota 413', async () => {
      // `event.quotaExceeded` reads in French as "the gallery is full, find the
      // organiser" — for a condition that clears in ninety seconds.
      const subject = buildSubject({ maxQueuedClips: 1 })
      await request(subject.app)
        .post(`${BASE}/clips`)
        .set('Cookie', cookie(subject.token))
        .attach('clip', aClipBody('one'), 'one.mov')

      const response = await request(subject.app)
        .post(`${BASE}/clips`)
        .set('Cookie', cookie(subject.token))
        .attach('clip', aClipBody('two'), 'two.mov')

      expect(response.status).toBe(429)
      expect(response.body.error.code).toBe('clip.queueFull')
      expect(response.headers['retry-after']).toBe('10')
    })

    it('stages nothing when the queue is full', async () => {
      const subject = buildSubject({ maxQueuedClips: 1 })
      await request(subject.app)
        .post(`${BASE}/clips`)
        .set('Cookie', cookie(subject.token))
        .attach('clip', aClipBody('one'), 'one.mov')
      const staged = subject.media.objectCount

      await request(subject.app)
        .post(`${BASE}/clips`)
        .set('Cookie', cookie(subject.token))
        .attach('clip', aClipBody('two'), 'two.mov')

      expect(subject.media.objectCount).toBe(staged)
      expect(await readdir(subject.tempDir)).toEqual([])
    })
  })

  describe('the quota', () => {
    it('answers 413 when the event genuinely has no room left', async () => {
      const subject = buildSubject({ quotaBytes: 1_000 })

      const response = await request(subject.app)
        .post(`${BASE}/clips`)
        .set('Cookie', cookie(subject.token))
        .attach('clip', aClipBody('one', 50_000), 'IMG_4021.MOV')

      expect(response.status).toBe(413)
      expect(response.body.error.code).toBe('event.quotaExceeded')
      expect(response.headers['retry-after']).toBeUndefined()
    })
  })

  describe('authorization', () => {
    it('refuses a caller with no device token', async () => {
      const subject = buildSubject()

      const response = await request(subject.app)
        .post(`${BASE}/clips`)
        .attach('clip', aClipBody(), 'IMG_4021.MOV')

      expect(response.status).toBe(401)
      expect(subject.clips.all).toEqual([])
    })

    it('refuses a token issued for another event', async () => {
      // The cross-event attack: a guest at one wedding pointing their own cookie at
      // another event's upload endpoint.
      const subject = buildSubject()

      const response = await request(subject.app)
        .post(`${BASE}/clips`)
        .set('Cookie', cookie(subject.galaToken))
        .attach('clip', aClipBody(), 'IMG_4021.MOV')

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('guest.wrongEvent')
      expect(subject.clips.all).toEqual([])
    })

    it('refuses a clip when the host turned video off for this event', async () => {
      const subject = buildSubject({ settings: { allowClips: false } })

      const response = await request(subject.app)
        .post(`${BASE}/clips`)
        .set('Cookie', cookie(subject.token))
        .attach('clip', aClipBody(), 'IMG_4021.MOV')

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('event.clipsNotAllowed')
    })

    it('refuses a clip for an event that is not taking uploads', async () => {
      const subject = buildSubject()
      subject.harness.events.seed(
        anEvent({ id: WEDDING, slug: 'mariage', joinCode: 'H7K2QM', status: 'closed' }),
      )

      const response = await request(subject.app)
        .post(`${BASE}/clips`)
        .set('Cookie', cookie(subject.token))
        .attach('clip', aClipBody(), 'IMG_4021.MOV')

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('event.notAcceptingUploads')
    })
  })

  it('answers a retried upload with the job it already has', async () => {
    // The retry on venue Wi-Fi. Two jobs would be two transcodes and two slides.
    const subject = buildSubject()
    const body = aClipBody()

    const first = await request(subject.app)
      .post(`${BASE}/clips`)
      .set('Cookie', cookie(subject.token))
      .attach('clip', body, 'IMG_4021.MOV')
    const second = await request(subject.app)
      .post(`${BASE}/clips`)
      .set('Cookie', cookie(subject.token))
      .attach('clip', body, 'IMG_4021.MOV')

    expect(second.status).toBe(202)
    expect(second.body.clipJobId).toBe(first.body.clipJobId)
    expect(subject.clips.all).toHaveLength(1)
  })
})

describe('GET /api/events/:eventSlug/clips/:clipJobId', () => {
  const JOB = '11111111-1111-4111-8111-111111111111'
  const OTHERS = '22222222-2222-4222-8222-222222222222'

  const seedJobs = (subject: Subject): void => {
    subject.clips.seed(
      aClipJob({ id: JOB, eventId: WEDDING, author: { kind: 'guest', id: GUEST }, createdAt: AT }),
      aClipJob({
        id: OTHERS,
        eventId: WEDDING,
        author: { kind: 'guest', id: OTHER_GUEST },
        createdAt: AT,
      }),
    )
  }

  it('tells a guest where their own clip has got to', async () => {
    const subject = buildSubject()
    seedJobs(subject)

    const response = await request(subject.app)
      .get(`${BASE}/clips/${JOB}`)
      .set('Cookie', cookie(subject.token))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      clipJobId: JOB,
      status: 'queued',
      photoId: `${JOB}-photo`,
      failureCode: null,
    })
  })

  it('is never cached: it is the one view whose purpose is to change', async () => {
    const subject = buildSubject()
    seedJobs(subject)

    const response = await request(subject.app)
      .get(`${BASE}/clips/${JOB}`)
      .set('Cookie', cookie(subject.token))

    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('answers 404 — never 403 — for another guest’s clip', async () => {
    // A 403 would confirm that this id names a real clip, and these ids go to phones.
    const subject = buildSubject()
    seedJobs(subject)

    const response = await request(subject.app)
      .get(`${BASE}/clips/${OTHERS}`)
      .set('Cookie', cookie(subject.token))

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('clipJob.notFound')
  })

  it('answers 404 for a job that does not exist', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .get(`${BASE}/clips/${JOB}`)
      .set('Cookie', cookie(subject.token))

    expect(response.status).toBe(404)
  })

  it('cannot be used to reach a job that belongs to another event', async () => {
    // The scoped read is what makes another evening's clip invisible rather than merely
    // forbidden: the id is real, the guest is real, and the event in the path is not its.
    const subject = buildSubject()
    const elsewhere = '33333333-3333-4333-8333-333333333333'
    subject.clips.seed(
      aClipJob({ id: elsewhere, eventId: GALA, author: { kind: 'guest', id: GUEST } }),
    )

    const response = await request(subject.app)
      .get(`${BASE}/clips/${elsewhere}`)
      .set('Cookie', cookie(subject.token))

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('clipJob.notFound')
  })

  it('refuses a caller with no device token', async () => {
    const subject = buildSubject()
    seedJobs(subject)

    const response = await request(subject.app).get(`${BASE}/clips/${JOB}`)

    expect(response.status).toBe(401)
  })

  it('refuses a job id that is not an opaque id at all', async () => {
    const subject = buildSubject()

    const response = await request(subject.app)
      .get(`${BASE}/clips/1`)
      .set('Cookie', cookie(subject.token))

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('reports the code behind a clip that was given up on', async () => {
    const subject = buildSubject()
    subject.clips.seed(
      aClipJob({
        id: JOB,
        eventId: WEDDING,
        author: { kind: 'guest', id: GUEST },
        status: 'failed',
        failureCode: 'clip.noVideoStream',
      }),
    )

    const response = await request(subject.app)
      .get(`${BASE}/clips/${JOB}`)
      .set('Cookie', cookie(subject.token))

    expect(response.body.failureCode).toBe('clip.noVideoStream')
  })
})

describe('withGuestClip', () => {
  it('fails closed when the authorization middleware did not run', async () => {
    // Unreachable behind `requireGuest`, and that is the point: a route that ever lost
    // its authorization decision must answer 401 rather than dereference an absent
    // principal and become a `TypeError` on a guest's phone mid-upload.
    const harness = buildHarness({
      routes: (app) => {
        app.get(
          '/unguarded',
          withGuestClip(async (_scope, _req, res) => {
            res.status(200).json({ reached: true })
          }),
        )
      },
    })

    const response = await request(harness.app).get('/unguarded')

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })
})
