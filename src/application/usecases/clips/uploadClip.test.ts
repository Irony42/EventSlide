import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_ATTEMPTS } from '../../../domain/clips/clipFailure'
import type { PhotoAuthor } from '../../../domain/photos/photo'
import { asEventId, asGuestId, asUserId } from '../../../domain/shared/ids'
import type { ContentHasher } from '../../ports/contentHasher'
import type { LogContext, Logger } from '../../ports/logger'
import type { TranscodeSpec } from '../../ports/videoTranscoder'
import { anEvent, aPhoto, type EventInput } from '../../testing/builders'
import { FakeClipJobRepository } from '../../testing/fakeClipJobRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { FakeVideoTranscoder, fakeClipBytes, notAClip } from '../../testing/fakeVideoTranscoder'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'
import { makeUploadClip, type UploadClip } from './uploadClip'

/**
 * Staging a clip. The rules this protects are the ones that decide what a guest standing
 * in a room is told, and every one of them has a different answer from the photo path:
 * a queue that can be full, a file that is never decoded on the request, and a row that
 * deliberately does not exist yet.
 */

const EVENT = asEventId('event-1')
const GUEST: PhotoAuthor = { kind: 'guest', guestId: asGuestId('guest-1') }
const HOST: PhotoAuthor = { kind: 'host', userId: asUserId('user-1') }

/** A digest of the bytes themselves, so two identical uploads collide as they would. */
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

class CapturingLogger implements Logger {
  readonly lines: { level: string; message: string }[] = []

  debug(message: string): void {
    this.lines.push({ level: 'debug', message })
  }

  info(message: string): void {
    this.lines.push({ level: 'info', message })
  }

  warn(message: string): void {
    this.lines.push({ level: 'warn', message })
  }

  error(message: string): void {
    this.lines.push({ level: 'error', message })
  }

  child(_bindings: LogContext): Logger {
    return this
  }
}

const aClipFile = (seed = 'one', byteSize = 4_000_000): Uint8Array =>
  fakeClipBytes({ width: 1920, height: 1080, durationMs: 9_000, byteSize, container: 'mp4' }).map(
    (byte, index) => (index === 40 ? seed.charCodeAt(0) : byte),
  )

describe('uploadClip', () => {
  let events: FakeEventRepository
  let clips: FakeClipJobRepository
  let photos: FakePhotoRepository
  let media: InMemoryMediaStore
  let transcoder: FakeVideoTranscoder
  let bus: RecordingEventBus
  let clock: FakeClock
  let ids: SequentialIdGenerator
  let logger: CapturingLogger
  let uploadClip: UploadClip

  const seedEvent = (input: EventInput = {}): void => {
    events.seed(anEvent({ id: 'event-1', ...input }))
  }

  const build = (maxQueuedClips = 20): void => {
    uploadClip = makeUploadClip({
      events,
      clips,
      photos,
      media,
      transcoder,
      hasher,
      bus,
      clock,
      ids,
      logger,
      limits: { maxQueuedClips },
    })
  }

  beforeEach(() => {
    events = new FakeEventRepository()
    clips = new FakeClipJobRepository()

    // The quota is "bytes on this event's disk", and a staged clip is on the disk. The
    // SQLite adapter reads `clip_jobs` inside its own `SUM`; here the fake is handed the
    // queue so the two answer the same number.
    photos = new FakePhotoRepository().chargeStagedBytesFrom(clips)
    // And the other way: staging a clip is judged against the album as well as the queue,
    // which is one statement in the adapter and two wired fakes here.
    clips.chargePhotoBytesFrom(photos)
    media = new InMemoryMediaStore()
    transcoder = new FakeVideoTranscoder()
    bus = new RecordingEventBus()
    clock = new FakeClock(new Date('2026-06-20T21:00:00.000Z'))
    ids = new SequentialIdGenerator()
    logger = new CapturingLogger()
    build()
  })

  const upload = (bytes = aClipFile(), author: PhotoAuthor = GUEST, caption?: string | null) =>
    uploadClip({
      eventId: EVENT,
      author,
      file: { bytes, declaredName: 'IMG_4021.MOV' },
      ...(caption === undefined ? {} : { caption }),
    })

  describe('the happy path', () => {
    it('queues the clip and hands back the row it will become', async () => {
      seedEvent()

      const result = await upload()

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.status).toBe('queued')
      expect(result.value.duplicate).toBe(false)
      expect(result.value.photoId).toBe('photo-1')
    })

    it('creates no photo row at all, which is the whole point of the queue', async () => {
      seedEvent()

      const result = await upload()

      expect(result.ok).toBe(true)
      // A clip that is still transcoding is not a photo in any state. It cannot reach
      // the wall because there is nothing on the wall's table to reach it with.
      expect((await photos.list(EVENT)).items).toEqual([])
    })

    it('writes the source before the row, so no row can name bytes that are absent', async () => {
      seedEvent()

      await upload()

      const job = clips.all[0]
      expect(job).toBeDefined()
      if (job === undefined) return
      expect(await media.exists(EVENT, job.sourceHash, 'source')).toBe(true)
    })

    it('announces the clip so the worker wakes instead of waiting for a tick', async () => {
      seedEvent()

      const result = await upload()

      expect(result.ok).toBe(true)
      expect(bus.published).toEqual([
        { type: 'clip.queued', eventId: EVENT, clipJobId: 'clip-job-1' },
      ])
    })

    it('keeps the guest caption, so it survives the queue onto the wall', async () => {
      seedEvent()

      await upload(aClipFile(), GUEST, 'Le premier slow')

      expect(clips.all[0]?.caption?.value).toBe('Le premier slow')
    })

    it('accepts a clip from the host’s own camera', async () => {
      seedEvent()

      const result = await upload(aClipFile(), HOST)

      expect(result.ok).toBe(true)
    })

    it('never decodes anything on the request: only the signature is read', async () => {
      // ffprobe is the same demuxer as ffmpeg and is not a cheap header read. Running
      // one per upload is exactly what the queue exists to avoid.
      seedEvent()

      await upload()

      expect(transcoder.calls).toEqual(['identify'])
    })
  })

  describe('the event gate', () => {
    it('refuses an event that does not exist', async () => {
      const result = await upload()

      expect(!result.ok && result.error.code).toBe('event.notFound')
    })

    it('refuses an event that is no longer taking uploads', async () => {
      seedEvent({ status: 'closed' })

      const result = await upload()

      expect(!result.ok && result.error.code).toBe('event.notAcceptingUploads')
    })

    it('refuses a clip when the host turned video off for this event', async () => {
      // A decision, not an apology: a room that does not want video on the wall says so,
      // and the guest is told which of the two it was.
      seedEvent({ settings: { allowClips: false } })

      const result = await upload()

      expect(!result.ok && result.error.code).toBe('event.clipsNotAllowed')
      expect(clips.all).toEqual([])
    })

    it('refuses a caption on an event that does not take captions', async () => {
      seedEvent({ settings: { allowCaptions: false } })

      const result = await upload(aClipFile(), GUEST, 'Le premier slow')

      expect(!result.ok && result.error.code).toBe('event.captionsNotAllowed')
    })

    it('refuses a caption the domain will not accept', async () => {
      seedEvent()

      const result = await upload(aClipFile(), GUEST, 'x'.repeat(500))

      expect(!result.ok && result.error.code).toBe('caption.tooLong')
    })
  })

  describe('what may be staged at all', () => {
    it('refuses a file that is not a video, before a byte reaches the disk', async () => {
      seedEvent()

      const result = await upload(notAClip())

      expect(!result.ok && result.error.code).toBe('clip.unsupportedFormat')
      expect(media.objectCount).toBe(0)
      expect(clips.all).toEqual([])
    })

    it('refuses an empty upload rather than queueing nothing', async () => {
      seedEvent()

      const result = await upload(new Uint8Array(0))

      expect(!result.ok && result.error.code).toBe('clip.unsupportedFormat')
    })

    it('does not trust a signature check to have rejected an empty file', async () => {
      // Fails closed on the entity's own rule: those bytes are charged to a quota from
      // the instant the row exists, so a zero-byte job would charge the event nothing
      // while occupying a slot in the queue.
      seedEvent()
      uploadClip = makeUploadClip({
        events,
        clips,
        photos,
        media,
        transcoder: {
          identify: (): 'mp4' => 'mp4',
          probe: (bytes: Uint8Array) => transcoder.probe(bytes),
          transcode: (bytes: Uint8Array, spec: TranscodeSpec) => transcoder.transcode(bytes, spec),
        },
        hasher,
        bus,
        clock,
        ids,
        logger,
        limits: { maxQueuedClips: 20 },
      })

      const result = await upload(new Uint8Array(0))

      expect(!result.ok && result.error.code).toBe('clip.sourceByteSizeInvalid')
      expect(media.objectCount).toBe(0)
    })
  })

  describe('idempotency', () => {
    it('recognises the same upload sent twice and does not queue it again', async () => {
      // The retry on venue Wi-Fi. Two jobs would be two transcodes and two slides.
      seedEvent()
      const bytes = aClipFile()

      const first = await upload(bytes)
      const second = await upload(bytes)

      expect(first.ok && second.ok).toBe(true)
      expect(second.ok && second.value.duplicate).toBe(true)
      expect(second.ok && second.value.clipJobId).toBe(first.ok ? first.value.clipJobId : '')
      expect(clips.all).toHaveLength(1)
    })

    it('announces nothing for a retry, so the worker is not woken for no work', async () => {
      seedEvent()
      const bytes = aClipFile()
      await upload(bytes)
      bus.clear()

      await upload(bytes)

      expect(bus.published).toEqual([])
    })

    it('treats a different clip as a different job', async () => {
      seedEvent()

      await upload(aClipFile('one'))
      await upload(aClipFile('two'))

      expect(clips.all).toHaveLength(2)
    })
  })

  describe('backpressure', () => {
    it('answers a full queue with a rate limit, never with the quota refusal', async () => {
      // `event.quotaExceeded` reads in French as "the gallery is full, go and find the
      // organiser". This condition clears in ninety seconds.
      seedEvent()
      build(1)
      await upload(aClipFile('one'))

      const result = await upload(aClipFile('two'))

      expect(!result.ok && result.error.kind).toBe('rateLimited')
      expect(!result.ok && result.error.code).toBe('clip.queueFull')
    })

    it('tells the client how long to wait', async () => {
      seedEvent()
      build(1)
      await upload(aClipFile('one'))

      const result = await upload(aClipFile('two'))

      expect(!result.ok && result.error.details['retryAfterSeconds']).toBe(10)
    })

    it('stages nothing when the queue is full', async () => {
      seedEvent()
      build(1)
      await upload(aClipFile('one'))
      const before = media.objectCount

      await upload(aClipFile('two'))

      expect(media.objectCount).toBe(before)
    })

    it('counts only the clips still holding disk', async () => {
      // A finished job gave its bytes back, so it must not hold a slot forever.
      seedEvent()
      build(1)
      const first = await upload(aClipFile('one'))
      expect(first.ok).toBe(true)
      const job = clips.all[0]
      expect(job).toBeDefined()
      if (job === undefined) return
      const claimed = job.claim(clock.now())
      expect(claimed.ok).toBe(true)
      if (!claimed.ok) return
      const done = claimed.value.succeed(clock.now())
      expect(done.ok).toBe(true)
      if (!done.ok) return
      await clips.save(done.value)

      const second = await upload(aClipFile('two'))

      expect(second.ok).toBe(true)
    })
  })

  describe('the quota', () => {
    it('refuses a clip the event has no room for', async () => {
      seedEvent({ quotaBytes: 1_000 })

      const result = await upload(aClipFile('one', 4_000))

      expect(!result.ok && result.error.code).toBe('event.quotaExceeded')
      expect(clips.all).toEqual([])
    })

    it('charges the staged source from the moment it is staged', async () => {
      // Counting only the transcoded output would make the database and the disk
      // disagree for the whole queue window — and the media store says that difference
      // means a leak.
      seedEvent({ quotaBytes: 10_000 })
      await upload(aClipFile('one', 6_000))

      const result = await upload(aClipFile('two', 6_000))

      expect(!result.ok && result.error.code).toBe('event.quotaExceeded')
    })

    it('counts an existing album against the same quota line', async () => {
      seedEvent({ quotaBytes: 10_000 })
      photos.seed(aPhoto({ id: 'photo-existing', eventId: 'event-1', byteSize: 9_000 }))

      const result = await upload(aClipFile('one', 4_000))

      expect(!result.ok && result.error.code).toBe('event.quotaExceeded')
    })

    it('admits only one of two simultaneous clips when only one fits', async () => {
      // The defect this guards: the depth, the byte total and the insert used to be
      // three calls with `await`s between them, so two guests uploading at the same
      // moment both read a quota with room and both committed. The overshoot was bounded
      // by the number of requests in flight, which is not a quota.
      seedEvent({ quotaBytes: 10_000 })

      const [first, second] = await Promise.all([
        upload(aClipFile('one', 6_000)),
        upload(aClipFile('two', 6_000)),
      ])

      expect([first?.ok, second?.ok].filter(Boolean)).toHaveLength(1)
      expect(clips.all).toHaveLength(1)
      expect(await photos.totalBytes(EVENT)).toBe(6_000)
    })

    it('leaves nothing on the disk for the simultaneous clip it refused', async () => {
      // The source is written before the row, so the loser of that race has already put
      // six thousand bytes somewhere. A refusal that leaves them is a leak charged to
      // nothing, which is the exact shape of the bug this whole seam exists to remove.
      seedEvent({ quotaBytes: 10_000 })

      await Promise.all([upload(aClipFile('one', 6_000)), upload(aClipFile('two', 6_000))])

      expect(media.objectCount).toBe(1)
    })

    it('admits only one of two simultaneous clips when the queue has one slot', async () => {
      seedEvent()
      build(1)

      const [first, second] = await Promise.all([
        upload(aClipFile('one')),
        upload(aClipFile('two')),
      ])

      expect([first?.ok, second?.ok].filter(Boolean)).toHaveLength(1)
      expect(clips.all).toHaveLength(1)
      expect(media.objectCount).toBe(1)
    })
  })

  describe('failure unwinding', () => {
    it('returns a named failure rather than a queued job when the disk refuses', async () => {
      seedEvent()
      media.failWritesAfter(0)

      const result = await upload()

      expect(!result.ok && result.error.code).toBe('clip.stageFailed')
      expect(clips.all).toEqual([])
    })

    it('removes the staged source when the queue row cannot be written', async () => {
      seedEvent()
      const broken = new FakeClipJobRepository()
      broken.stage = async (): Promise<never> => {
        throw new Error('database is locked')
      }
      clips = broken
      build()

      const result = await upload()

      expect(!result.ok && result.error.code).toBe('clip.stageFailed')
      expect(media.objectCount).toBe(0)
      expect(bus.published).toEqual([])
    })

    it('refuses the upload when the hasher does not answer with a digest', async () => {
      seedEvent()
      uploadClip = makeUploadClip({
        events,
        clips,
        photos,
        media,
        transcoder,
        hasher: { sha256Hex: (): string => 'not-a-digest' },
        bus,
        clock,
        ids,
        logger,
        limits: { maxQueuedClips: 20 },
      })

      const result = await upload()

      expect(!result.ok && result.error.code).toBe('photo.hashFailed')
      expect(logger.lines.some((line) => line.level === 'error')).toBe(true)
    })
  })

  describe('the retry ladder is not this use case’s business', () => {
    it('does not resurrect a job that was given up on', async () => {
      // A failed job keeps its row, so the same bytes answer "already handled" rather
      // than starting a fourth attempt the ladder has already refused.
      seedEvent()
      const bytes = aClipFile()
      await upload(bytes)
      const job = clips.all[0]
      expect(job).toBeDefined()
      if (job === undefined) return

      let current = job
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const claimed = current.claim(clock.now())
        expect(claimed.ok).toBe(true)
        if (!claimed.ok) return
        const failed = claimed.value.fail('clip.transcodeFailed', clock.now())
        expect(failed.ok).toBe(true)
        if (!failed.ok) return
        current = failed.value
      }
      await clips.save(current)

      const again = await upload(bytes)

      expect(again.ok && again.value.status).toBe('failed')
      expect(again.ok && again.value.duplicate).toBe(true)
    })
  })
})
