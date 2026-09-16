import { beforeEach, describe, expect, it } from 'vitest'
import { ContentHash } from '../../../domain/photos/contentHash'
import { Dimensions } from '../../../domain/photos/dimensions'
import { asEventId, asPhotoId } from '../../../domain/shared/ids'
import type { ContentHasher } from '../../ports/contentHasher'
import type { LogContext, Logger } from '../../ports/logger'
import {
  AT,
  aClip,
  aClipJob,
  anEvent,
  aPhoto,
  type ClipJobInput,
  type EventInput,
} from '../../testing/builders'
import { FakeClipJobRepository } from '../../testing/fakeClipJobRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { FakeVideoTranscoder, fakeClipBytes, notAClip } from '../../testing/fakeVideoTranscoder'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeTranscodeNextClip, type TranscodeNextClip } from './transcodeNextClip'

/**
 * One pass of the queue. These are the tests that hold the line the whole clip design
 * rests on: a `photos` row appears only when there is a transcoded file behind it, the
 * staged source stops costing the event the moment it is replaced, and a process that
 * died half-way does not cost a guest their clip or the album a duplicate.
 */

const EVENT = asEventId('event-1')

/** Built through the domain factory, so a fixture is a size the entity accepts. */
const dimensionsOf = (width: number, height: number): Dimensions => {
  const result = Dimensions.create(width, height)
  if (!result.ok) throw new Error('bad fixture dimensions')
  return result.value
}

/** A digest of the bytes, so two different outputs get two different names. */
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

const POLICY = {
  maxHeight: 720,
  maxDurationMs: 15_000,
  maxOutputBytes: 40_000_000,
  posterMaxEdge: 480,
  maxPixels: 33_177_600,
}

const sourceBytes = (
  overrides: Parameters<typeof fakeClipBytes>[0] = { width: 1920, height: 1080, durationMs: 9_000 },
) => fakeClipBytes(overrides)

describe('transcodeNextClip', () => {
  let events: FakeEventRepository
  let clips: FakeClipJobRepository
  let photos: FakePhotoRepository
  let media: InMemoryMediaStore
  let transcoder: FakeVideoTranscoder
  let bus: RecordingEventBus
  let clock: FakeClock
  let logger: CapturingLogger
  let transcodeNextClip: TranscodeNextClip

  const build = (): void => {
    transcodeNextClip = makeTranscodeNextClip({
      events,
      clips,
      photos,
      media,
      transcoder,
      hasher,
      bus,
      clock,
      logger,
      policy: POLICY,
    })
  }

  beforeEach(() => {
    events = new FakeEventRepository()
    clips = new FakeClipJobRepository()
    photos = new FakePhotoRepository().chargeStagedBytesFrom(clips)
    media = new InMemoryMediaStore()
    transcoder = new FakeVideoTranscoder()
    bus = new RecordingEventBus()
    clock = new FakeClock(AT)
    logger = new CapturingLogger()
    build()
  })

  const seedEvent = (input: EventInput = {}): void => {
    events.seed(anEvent({ id: 'event-1', ...input }))
  }

  /** Stages a job the way `uploadClip` would: the source on the disk, then the row. */
  const stage = async (
    bytes: Uint8Array = sourceBytes(),
    input: ClipJobInput = {},
  ): Promise<void> => {
    const job = aClipJob({ id: 'clip-job-1', eventId: 'event-1', sourceByteSize: 6_000, ...input })
    await media.put(job.eventId, job.sourceHash, 'source', bytes)
    clips.seed(job)
  }

  describe('an empty queue', () => {
    it('answers idle rather than inventing work', async () => {
      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind).toBe('idle')
    })

    it('leaves a job whose backoff has not elapsed alone', async () => {
      seedEvent()
      await stage(sourceBytes(), { notBefore: new Date(AT.getTime() + 60_000) })

      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind).toBe('idle')
    })
  })

  describe('a clip that transcodes', () => {
    beforeEach(async () => {
      seedEvent()
      await stage()
    })

    it('creates the photo row the guest has been waiting for', async () => {
      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind).toBe('transcoded')
      const photo = await photos.findById(EVENT, asPhotoId('clip-job-1-photo'))
      expect(photo?.kind).toBe('clip')
    })

    it('uses the id minted at staging, so a client already knew what to watch for', async () => {
      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind === 'transcoded' && result.value.photoId).toBe(
        'clip-job-1-photo',
      )
    })

    it('records the duration measured on the output, not the one the source claimed', async () => {
      // `-t` and the output size bound both truncate, and the wall lays out what it will
      // really play.
      const photo = await (async () => {
        await transcodeNextClip()
        return photos.findById(EVENT, asPhotoId('clip-job-1-photo'))
      })()

      const facet = photo?.facet
      expect(facet?.kind).toBe('clip')
      if (facet?.kind !== 'clip') return
      expect(facet.duration.ms).toBe(9_000)
    })

    it('stores the video and the poster under their own digests', async () => {
      await transcodeNextClip()

      const photo = await photos.findById(EVENT, asPhotoId('clip-job-1-photo'))
      const facet = photo?.facet
      expect(facet?.kind).toBe('clip')
      if (photo === null || photo === undefined || facet?.kind !== 'clip') return

      expect(await media.exists(EVENT, photo.contentHash, 'video')).toBe(true)
      expect(await media.exists(EVENT, facet.posterHash, 'poster')).toBe(true)
      expect(photo.contentHash.equals(facet.posterHash)).toBe(false)
    })

    it('marks the job done and stops charging the staged source', async () => {
      const before = await photos.totalBytes(EVENT)
      await transcodeNextClip()

      const job = clips.all[0]
      expect(job?.status).toBe('done')
      expect(await clips.stagedBytes(EVENT)).toBe(0)
      expect(await photos.totalBytes(EVENT)).not.toBe(before)
    })

    it('removes the guest’s un-stripped upload once it is no longer needed', async () => {
      const job = clips.all[0]
      expect(job).toBeDefined()
      if (job === undefined) return

      await transcodeNextClip()

      expect(await media.exists(EVENT, job.sourceHash, 'source')).toBe(false)
    })

    it('announces the clip exactly as an uploaded photo is announced', async () => {
      await transcodeNextClip()

      expect(bus.published).toEqual([
        { type: 'photo.uploaded', eventId: EVENT, photoId: 'clip-job-1-photo' },
      ])
    })

    it('leaves the clip pending, so a host still decides whether it reaches the wall', async () => {
      await transcodeNextClip()

      expect((await photos.findById(EVENT, asPhotoId('clip-job-1-photo')))?.status).toBe('pending')
    })

    it('probes before it encodes', async () => {
      await transcodeNextClip()

      expect(transcoder.calls).toEqual(['probe', 'transcode'])
    })
  })

  describe('an auto-publish event', () => {
    it('publishes the clip with an automatic reviewer and says so', async () => {
      seedEvent({ settings: { moderation: 'auto' } })
      await stage()

      await transcodeNextClip()

      const photo = await photos.findById(EVENT, asPhotoId('clip-job-1-photo'))
      expect(photo?.status).toBe('published')
      expect(photo?.review?.kind).toBe('automatic')
      expect(bus.published).toEqual([
        { type: 'photo.uploaded', eventId: EVENT, photoId: 'clip-job-1-photo' },
        {
          type: 'photo.moderated',
          eventId: EVENT,
          photoId: 'clip-job-1-photo',
          status: 'published',
        },
      ])
    })
  })

  describe('crash recovery', () => {
    it('finishes the paperwork rather than encoding a second copy', async () => {
      // The photo id is fixed at staging, so a process that died between the insert and
      // the bookkeeping leaves a row this pass can recognise. Encoding again would write
      // a second file under a different digest and orphan the first.
      seedEvent()
      await stage()
      photos.seed(aPhoto({ id: 'clip-job-1-photo', eventId: 'event-1', clip: {} }))

      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind === 'transcoded' && result.value.recovered).toBe(true)
      expect(transcoder.calls).toEqual([])
      expect(clips.all[0]?.status).toBe('done')
    })

    it('releases the staged source of a job it recovered', async () => {
      seedEvent()
      await stage()
      const job = clips.all[0]
      photos.seed(aPhoto({ id: 'clip-job-1-photo', eventId: 'event-1', clip: {} }))

      await transcodeNextClip()

      expect(job !== undefined && (await media.exists(EVENT, job.sourceHash, 'source'))).toBe(false)
    })
  })

  describe('the pixel budget', () => {
    it('refuses a frame too large to decode safely, from the header', async () => {
      // `maxHeight` is not this control: it scales the *output*, and the filter that does
      // it runs after the decoder has already allocated the frame. A valid 16000x16000
      // HEVC is about 380 MB a frame, which is an OOM kill on a venue box.
      seedEvent()
      await stage(sourceBytes({ width: 16_000, height: 16_000, durationMs: 5_000 }))

      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind === 'failed' && result.value.code).toBe(
        'clip.pixelBudgetExceeded',
      )
    })

    it('gives up at once rather than retrying a bomb three times', async () => {
      // Classified transient, an OOM kill would pin the single worker for three passes
      // while a room full of guests waits behind it.
      seedEvent()
      await stage(sourceBytes({ width: 16_000, height: 16_000, durationMs: 5_000 }))

      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind === 'failed' && result.value.willRetry).toBe(false)
      expect(clips.all[0]?.status).toBe('failed')
    })

    it('never reaches the encoder with one', async () => {
      seedEvent()
      await stage(sourceBytes({ width: 16_000, height: 16_000, durationMs: 5_000 }))

      await transcodeNextClip()

      expect(transcoder.calls).toEqual(['probe'])
    })

    it('admits an 8K clip, which a phone can genuinely record', async () => {
      seedEvent()
      await stage(sourceBytes({ width: 7_680, height: 4_320, durationMs: 5_000 }))

      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind).toBe('transcoded')
    })
  })

  describe('a clip that will never transcode', () => {
    it('gives up at once on a file with no video stream', async () => {
      seedEvent()
      await stage(fakeClipBytes({ width: 2, height: 2, durationMs: 5_000, noVideo: true }))

      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind).toBe('failed')
      expect(result.ok && result.value.kind === 'failed' && result.value.willRetry).toBe(false)
      expect(clips.all[0]?.status).toBe('failed')
      expect(clips.all[0]?.failureCode).toBe('clip.noVideoStream')
    })

    it('gives up on a recording longer than the cap', async () => {
      // Refused at the probe. The encoder is separately told to stop at the cap, because
      // a truncated container declares whatever it declared before the phone died.
      seedEvent()
      await stage(sourceBytes({ width: 1280, height: 720, durationMs: 40_000 }))

      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind === 'failed' && result.value.code).toBe('clip.tooLong')
    })

    it('gives up on bytes that are not a video at all', async () => {
      seedEvent()
      await stage(notAClip())

      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind === 'failed' && result.value.code).toBe(
        'clip.unsupportedFormat',
      )
    })

    it('still reaches a terminal row when the disk refuses the unlink', async () => {
      // **The failure is correlated, which is what makes this the dangerous one.** What
      // produces `clip.storageFailed` — an SSD erroring, the filesystem remounting
      // read-only — is exactly what makes the unlink throw, and `fsMediaStore.delete`
      // swallows only ENOENT. Unguarded, that exception left the pass and the row stayed
      // `running` for the life of the process, because `recoverAbandoned` is boot-only:
      // one of twenty queue slots gone, the event charged for bytes nobody will collect,
      // the digest locked against the guest's own retry, and "running" answered all
      // evening. Twenty of those and every clip upload on the box is a 429.
      //
      // Leaving bytes behind is the trade this feature makes; the sweep collects them.
      // Stranding a `running` row is not a trade.
      seedEvent()
      await stage(notAClip())
      media.delete = async (): Promise<never> => {
        throw new Error('EROFS: read-only file system')
      }

      const result = await transcodeNextClip()

      expect(result.ok).toBe(true)
      const job = clips.all[0]
      expect(job?.status).toBe('failed')
      // The slot is released and the guest is told, which is the whole point.
      expect(await clips.countActive()).toBe(0)
      expect(bus.published).toEqual([
        { type: 'clip.failed', eventId: EVENT, clipJobId: 'clip-job-1' },
      ])
      expect(logger.lines.some((line) => line.level === 'warn')).toBe(true)
    })

    it('unwinds its own output without stranding the row when the unlink throws', async () => {
      // The same class, on the other path: `unwind` is called from inside two catch
      // blocks, so a throwing unlink there strands the row identically — and both are
      // reached by the same failing disk.
      seedEvent({ quotaBytes: 6_500 })
      await stage()
      const realDelete = media.delete.bind(media)
      let deletes = 0
      media.delete = async (eventId, hash): Promise<void> => {
        deletes += 1
        if (deletes === 1) throw new Error('EIO: i/o error')
        return realDelete(eventId, hash)
      }

      const result = await transcodeNextClip()

      expect(result.ok).toBe(true)
      expect(clips.all[0]?.status).toBe('failed')
      expect(await clips.countActive()).toBe(0)
    })

    it('removes the staged source and says so, so nothing is left to reconcile', async () => {
      seedEvent()
      await stage(notAClip())
      const job = clips.all[0]

      await transcodeNextClip()

      expect(job !== undefined && (await media.exists(EVENT, job.sourceHash, 'source'))).toBe(false)
      expect(bus.published).toEqual([
        { type: 'clip.failed', eventId: EVENT, clipJobId: 'clip-job-1' },
      ])
    })

    it('gives up when the staged bytes are gone', async () => {
      seedEvent()
      clips.seed(aClipJob({ id: 'clip-job-1', eventId: 'event-1' }))

      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind === 'failed' && result.value.code).toBe(
        'clip.sourceMissing',
      )
    })

    it('gives up when the event was purged while the clip waited', async () => {
      await stage()

      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind === 'failed' && result.value.code).toBe(
        'event.notFound',
      )
      expect(clips.all[0]?.status).toBe('failed')
    })
  })

  describe('a failure that might clear on its own', () => {
    it('puts a clip back on the queue when the encoder itself fails', async () => {
      seedEvent()
      await stage(
        sourceBytes({
          width: 1280,
          height: 720,
          durationMs: 5_000,
          transcodeError: 'clip.transcodeFailed',
        }),
      )

      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind === 'failed' && result.value.willRetry).toBe(true)
      expect(clips.all[0]?.status).toBe('queued')
    })

    it('keeps the staged source so the retry has something to work on', async () => {
      seedEvent()
      await stage(
        sourceBytes({
          width: 1280,
          height: 720,
          durationMs: 5_000,
          transcodeError: 'clip.transcodeFailed',
        }),
      )
      const job = clips.all[0]

      await transcodeNextClip()

      expect(job !== undefined && (await media.exists(EVENT, job.sourceHash, 'source'))).toBe(true)
      expect(bus.published).toEqual([])
    })

    it('puts a clip back when the media store refuses the output', async () => {
      seedEvent()
      await stage()
      media.failWritesAfter(0)

      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind === 'failed' && result.value.code).toBe(
        'clip.storageFailed',
      )
      expect(clips.all[0]?.status).toBe('queued')
    })

    it('puts a clip back when the row cannot be inserted', async () => {
      seedEvent()
      await stage()
      photos.saveManyWithinLimits = async (): Promise<never> => {
        throw new Error('database is locked')
      }

      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind === 'failed' && result.value.code).toBe(
        'clip.storageFailed',
      )
      expect(logger.lines.some((line) => line.level === 'error')).toBe(true)
    })

    it('keeps no transcoded media behind when the insert fails', async () => {
      seedEvent()
      await stage()
      const stagedObjects = media.objectCount
      photos.saveManyWithinLimits = async (): Promise<never> => {
        throw new Error('database is locked')
      }

      await transcodeNextClip()

      expect(media.objectCount).toBe(stagedObjects)
    })
  })

  it('tolerates the guest deleting their clip while it was being transcoded', async () => {
    // `deletePhoto` retires the job, and `save` is update-only for exactly this: writing
    // it back would either re-insert a `done` row naming a photo that no longer exists,
    // or collide with the guest's re-upload on the unique index and throw out of here,
    // leaving this job `running` for ever with its source never released.
    //
    // The source stays too: the re-upload may already hold that digest, and the
    // reconciliation sweep is the collector that can tell.
    seedEvent()
    await stage()
    const staged = clips.all[0]
    expect(staged).toBeDefined()
    if (staged === undefined) return

    // The delete lands while the encoder is running, which is the window that matters.
    const encode = transcoder.transcode.bind(transcoder)
    transcoder.transcode = async (bytes, spec) => {
      await clips.deleteForPhoto(EVENT, staged.photoId)
      return encode(bytes, spec)
    }

    const result = await transcodeNextClip()

    expect(result.ok).toBe(true)
    expect(clips.all).toEqual([])
    expect(await media.exists(EVENT, staged.sourceHash, 'source')).toBe(true)
    expect(logger.lines.some((line) => line.level === 'info')).toBe(true)
    // **And the photo row this pass inserted stays.** Retiring the job in this window is
    // only reachable from `deletePhoto`, which needs a photo row — so when the row does
    // not exist yet, as here, the only callers are a crash-recovered job's old row or an
    // operator. The clip itself is finished, plays, and has a poster; deleting it because
    // its queue entry went would throw away a video nobody asked to lose. The next test
    // covers the window a guest can actually reach.
    expect(await photos.findById(EVENT, staged.photoId)).not.toBeNull()
  })

  it('announces a clip the guest deleted between the insert and the commit, harmlessly', async () => {
    /**
     * **The window the previous test does not cover**, and the one a guest can actually
     * reach: `deletePhoto` needs a photo row, so a clip can only be deleted *after* this
     * pass inserts one — and there are two awaits between that insert and `finish`.
     *
     * What follows is `photo.uploaded` and, under `moderation: 'auto'`, a
     * `photo.moderated` for a photo id that no longer resolves. That is deliberate and
     * it is safe, for a reason worth writing down rather than assuming: every frame on
     * this bus is a **signal, not data** — `streamRoutes` forwards a bare `{"type":…}`
     * and `useEventStream` refetches the list, which comes back without the deleted row.
     * A consumer that looked the id up would be reading a push as data, which
     * docs/API.md section 7 rules out precisely because there is no request to authorize
     * such a push against.
     *
     * Suppressing the publish would cost more than it saves: the pass would have to
     * re-read the row it just inserted, and a wall that missed a legitimate upload
     * because a delete raced it is a worse failure than one extra refetch.
     */
    seedEvent({ settings: { moderation: 'auto' } })
    await stage()
    const staged = clips.all[0]
    expect(staged).toBeDefined()
    if (staged === undefined) return

    // Between the insert and `finish`: the status update is the last step before it.
    const updateStatuses = photos.updateStatuses.bind(photos)
    photos.updateStatuses = async (eventId, photoIds, status, reviewer) => {
      const published = await updateStatuses(eventId, photoIds, status, reviewer)
      await photos.delete(staged.eventId, staged.photoId)
      await clips.deleteForPhoto(staged.eventId, staged.photoId)
      return published
    }

    const result = await transcodeNextClip()

    expect(result.ok).toBe(true)
    // The row and the job are both gone, and the source is kept for the sweep: the
    // guest's re-upload may already hold that digest.
    expect(await photos.findById(EVENT, staged.photoId)).toBeNull()
    expect(clips.all).toEqual([])
    expect(await media.exists(EVENT, staged.sourceHash, 'source')).toBe(true)
    // Announced anyway, and that is the documented answer rather than an oversight.
    expect(bus.published.map((event) => event.type)).toEqual(
      expect.arrayContaining(['photo.uploaded', 'photo.moderated']),
    )
  })

  describe('the quota, decided against committed state', () => {
    it('refuses a clip the event no longer has room for', async () => {
      seedEvent({ quotaBytes: 6_500 })
      await stage()

      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind === 'failed' && result.value.code).toBe(
        'event.quotaExceeded',
      )
      expect(result.ok && result.value.kind === 'failed' && result.value.willRetry).toBe(false)
    })

    it('keeps no media for a clip the write transaction turned away', async () => {
      seedEvent({ quotaBytes: 6_500 })
      await stage()

      await transcodeNextClip()

      expect(media.objectCount).toBe(0)
    })

    it('never unwinds a poster another clip is showing', async () => {
      // A poster is a deterministic JPEG of a frame one second in and carries no unique
      // index, so two clips whose opening second looks the same — a dark room, a stage
      // before the lights — share it. Unwinding this one's output without asking destroys
      // the published clip's `thumbUrl` and `displayUrl` both: a broken tile on the wall,
      // in the grid and in the album, while its mp4 goes on playing.
      seedEvent({ quotaBytes: 6_500 })
      await stage()
      // Whatever the fake encoder is about to produce, already published under another
      // row. `transcodeNextClip` computes the digests from those bytes, so this is the
      // same collision the real pipeline has.
      const transcoded = await transcoder.transcode(sourceBytes(), {
        maxHeight: POLICY.maxHeight,
        maxDurationMs: POLICY.maxDurationMs,
        maxOutputBytes: POLICY.maxOutputBytes,
        posterMaxEdge: POLICY.posterMaxEdge,
      })
      expect(transcoded.ok).toBe(true)
      if (!transcoded.ok) return
      const sharedPoster = hasher.sha256Hex(transcoded.value.poster.bytes)
      photos.seed(
        aClip({
          id: 'photo-published',
          eventId: 'event-1',
          status: 'published',
          contentHash: 'e'.repeat(64),
          clip: { posterHash: sharedPoster },
        }),
      )
      const posterHash = ContentHash.create(sharedPoster)
      expect(posterHash.ok).toBe(true)
      if (!posterHash.ok) return
      await media.put(EVENT, posterHash.value, 'poster', transcoded.value.poster.bytes)

      await transcodeNextClip()

      expect(await media.exists(EVENT, posterHash.value, 'poster')).toBe(true)
    })

    it('credits the clip’s own staged source, which it is replacing rather than adding to', async () => {
      // The job is still `running` when its output is inserted — marking it `done` first
      // would open a window where a crash loses the accounting — so the plain sum charges
      // the event for the guest's original *and* the 720p result it became. A phone
      // original is routinely twenty times its output, so an event with plenty of room
      // for the clip was answered `event.quotaExceeded`; that code is permanent, so the
      // outputs were unwound, the source deleted and the row left terminal, and the host
      // freeing space did not help because the re-upload deduped onto that row.
      seedEvent({ quotaBytes: 8_100_000 })
      await stage(sourceBytes(), { sourceByteSize: 8_000_000 })

      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind).toBe('transcoded')
    })

    it('credits only its own source, never another clip still waiting', async () => {
      // The correction names one job precisely so it cannot become "ignore the queue".
      seedEvent({ quotaBytes: 8_100_000 })
      await stage(sourceBytes(), { sourceByteSize: 8_000_000 })
      clips.seed(aClipJob({ id: 'clip-job-2', eventId: 'event-1', sourceByteSize: 8_000_000 }))

      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind === 'failed' && result.value.code).toBe(
        'event.quotaExceeded',
      )
    })

    it('refuses a clip that would pass the guest’s photo limit', async () => {
      seedEvent({ settings: { maxPhotosPerGuest: 1 } })
      photos.seed(aPhoto({ id: 'photo-existing', eventId: 'event-1' }))
      await stage()

      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind === 'failed' && result.value.code).toBe(
        'event.photoLimitReached',
      )
    })
  })

  describe('the hasher', () => {
    it('gives up when the hasher does not answer with a digest', async () => {
      seedEvent()
      await stage()
      transcodeNextClip = makeTranscodeNextClip({
        events,
        clips,
        photos,
        media,
        transcoder,
        hasher: { sha256Hex: (): string => 'not-a-digest' },
        bus,
        clock,
        logger,
        policy: POLICY,
      })

      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind === 'failed' && result.value.code).toBe(
        'photo.hashFailed',
      )
    })

    it('gives up when only the poster digest is unusable', async () => {
      seedEvent()
      await stage()
      let call = 0
      transcodeNextClip = makeTranscodeNextClip({
        events,
        clips,
        photos,
        media,
        transcoder,
        hasher: {
          sha256Hex: (): string => {
            call += 1
            return call === 1 ? 'a'.repeat(64) : 'not-a-digest'
          },
        },
        bus,
        clock,
        logger,
        policy: POLICY,
      })

      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind === 'failed' && result.value.code).toBe(
        'photo.hashFailed',
      )
    })
  })

  describe('a repository that hands back a job it did not claim', () => {
    /**
     * Fail-closed, both ways round. Every transition in this pass goes through the
     * entity, so a `claimNext` that answered with an unclaimed row — a broken adapter, a
     * second writer — cannot be turned into a `done` job or a recorded failure by
     * accident. It is unreachable through the real adapters and it is exactly the case a
     * guard exists for, so it is exercised rather than asserted in a comment.
     */
    const handBackUnclaimed = (): void => {
      clips.claimNext = async (): Promise<ReturnType<typeof aClipJob>> =>
        aClipJob({ id: 'clip-job-1', eventId: 'event-1', status: 'queued' })
    }

    it('refuses to finish a job that is not running', async () => {
      seedEvent()
      await stage()
      handBackUnclaimed()

      const result = await transcodeNextClip()

      expect(!result.ok && result.error.code).toBe('clipJob.illegalTransition')
    })

    it('refuses to record a failure against a job that is not running', async () => {
      seedEvent()
      await stage(notAClip())
      handBackUnclaimed()

      const result = await transcodeNextClip()

      expect(!result.ok && result.error.code).toBe('clipJob.illegalTransition')
    })
  })

  describe('an output that is not a clip', () => {
    it('gives up when the encoder produced less than a clip’s worth of video', async () => {
      // Measured on the output, so a `-fs` cut that left eleven frames is refused here
      // rather than becoming a slide that flashes past on the projector.
      seedEvent()
      await stage()
      transcodeNextClip = makeTranscodeNextClip({
        events,
        clips,
        photos,
        media,
        transcoder: {
          available: () => true,
          identify: (bytes: Uint8Array) => transcoder.identify(bytes),
          probe: (bytes: Uint8Array) => transcoder.probe(bytes),
          transcode: async () => ({
            ok: true as const,
            value: {
              video: {
                bytes: Uint8Array.of(1, 2, 3),
                byteSize: 3,
                dimensions: dimensionsOf(320, 240),
                durationMs: 10,
              },
              poster: {
                bytes: Uint8Array.of(4),
                byteSize: 1,
                dimensions: dimensionsOf(120, 90),
              },
            },
          }),
        },
        hasher,
        bus,
        clock,
        logger,
        policy: POLICY,
      })

      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind === 'failed' && result.value.code).toBe('clip.tooShort')
      // Permanent, so nothing of this clip is left anywhere — not the output, and not
      // the guest's un-stripped upload.
      expect(media.objectCount).toBe(0)
    })
  })

  describe('a photo the entity refuses', () => {
    it('gives up rather than writing a row the domain would not accept', async () => {
      // A zero-byte output is not a clip. `Photo.create` says so, and the pass must not
      // leave the transcoded files behind when it does.
      seedEvent()
      await stage()
      const emptyOutput = {
        available: () => true,
        identify: (bytes: Uint8Array) => transcoder.identify(bytes),
        probe: (bytes: Uint8Array) => transcoder.probe(bytes),
        transcode: async () => ({
          ok: true as const,
          value: {
            video: {
              bytes: new Uint8Array(0),
              byteSize: 0,
              dimensions: dimensionsOf(320, 240),
              durationMs: 5_000,
            },
            poster: {
              bytes: new Uint8Array(0),
              byteSize: 0,
              dimensions: dimensionsOf(120, 90),
            },
          },
        }),
      }
      transcodeNextClip = makeTranscodeNextClip({
        events,
        clips,
        photos,
        media,
        transcoder: emptyOutput,
        hasher,
        bus,
        clock,
        logger,
        policy: POLICY,
      })

      const result = await transcodeNextClip()

      expect(result.ok && result.value.kind).toBe('failed')
      expect(await photos.findById(EVENT, asPhotoId('clip-job-1-photo'))).toBeNull()
      // Only the staged source is left — the transcoded files this pass wrote are gone.
      expect(media.objectCount).toBe(1)
    })
  })
})
