import { beforeEach, describe, expect, it } from 'vitest'
import { ContentHash } from '../../../domain/photos/contentHash'
import { asEventId } from '../../../domain/shared/ids'
import type { LogContext, Logger } from '../../ports/logger'
import { AT, aClip, aClipJob, anEvent, aPhoto, atPlus } from '../../testing/builders'
import type { ContentHasher } from '../../ports/contentHasher'
import { FakeClipJobRepository } from '../../testing/fakeClipJobRepository'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeVideoTranscoder } from '../../testing/fakeVideoTranscoder'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeTranscodeNextClip } from '../clips/transcodeNextClip'
import { FakeClock } from '../../testing/fakeClock'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { makeSweepOrphanedMedia, type SweepOrphanedMedia } from './sweepOrphanedMedia'

/**
 * The collector the rest of the media story depends on.
 *
 * Several paths in this codebase deliberately leak rather than delete — the clip upload
 * on the exit taken because its row is already gone, an unlink the disk refuses,
 * `recoverClipJobs` giving up on a job the box kept killing, and the reservation reaper —
 * because deleting by digest can destroy a byte-identical file somebody else owns. That
 * trade is only honest if something eventually collects, and these are the rules by which
 * it does.
 *
 * The two that matter most are the ones that protect a live event: an object written
 * moments ago is never collected, because every write path here is bytes first and row
 * second; and a source a live job names is never collected however old it is, because a
 * clip can sit behind twenty others and that file is the only copy. Both are checked in
 * bulk and then **again immediately before the unlink**, because the bulk answer is a
 * snapshot and a guest can re-upload inside it.
 */

const EVENT = asEventId('event-1')
const OTHER = asEventId('event-2')
const THIRD = asEventId('event-3')

const FIFTEEN_MINUTES = 15 * 60 * 1000

/** A stable digest from a seed, as the builders take it. */
const hexOf = (seed: string): string => seed.padEnd(64, '0').slice(0, 64)

const hashOf = (seed: string): ContentHash => {
  const result = ContentHash.create(hexOf(seed))
  if (!result.ok) throw new Error(`bad fixture hash: ${seed}`)
  return result.value
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

describe('sweepOrphanedMedia', () => {
  let photos: FakePhotoRepository
  let clips: FakeClipJobRepository
  let media: InMemoryMediaStore
  /** The store's own clock, so `modifiedAt` is a fact a test sets rather than wall time. */
  let written: FakeClock
  let now: FakeClock
  let logger: CapturingLogger
  let sweep: SweepOrphanedMedia

  const build = (minimumAgeMs = FIFTEEN_MINUTES, maxDigestsPerPass = 50_000): void => {
    sweep = makeSweepOrphanedMedia({
      photos,
      clips,
      media,
      clock: now,
      logger,
      policy: { minimumAgeMs, maxDigestsPerPass },
    })
  }

  beforeEach(() => {
    photos = new FakePhotoRepository()
    clips = new FakeClipJobRepository()
    written = new FakeClock(AT)
    media = new InMemoryMediaStore(written)
    // An hour after everything the tests write, so the freshness guard is off unless a
    // case deliberately turns it on.
    now = new FakeClock(atPlus(60 * 60 * 1000))
    logger = new CapturingLogger()
    build()
  })

  describe('what it collects', () => {
    it('removes a digest no row names', async () => {
      await media.put(EVENT, hashOf('ab1'), 'display', Uint8Array.of(1, 2, 3))

      const report = await sweep()

      expect(report).toMatchObject({ scanned: 1, collected: 1, bytes: 3 })
      expect(await media.exists(EVENT, hashOf('ab1'), 'display')).toBe(false)
    })

    it('removes every rendition under that digest in one go', async () => {
      // Deleting is by digest because a digest is the bytes: if nothing names the hash,
      // nothing names any rendition of it.
      await media.put(EVENT, hashOf('ab1'), 'display', Uint8Array.of(1))
      await media.put(EVENT, hashOf('ab1'), 'thumb', Uint8Array.of(2))
      await media.put(EVENT, hashOf('ab1'), 'original', Uint8Array.of(3, 4))

      const report = await sweep()

      expect(report).toMatchObject({ scanned: 1, collected: 1, bytes: 4 })
      expect(media.variantsOf(EVENT, hashOf('ab1'))).toEqual([])
    })

    it('collects the source of a job that is finished with it', async () => {
      // `transcodeNextClip` deletes this itself on the happy path; this is the crash
      // that happened between the two.
      clips.seed(
        aClipJob({ id: 'job-1', eventId: 'event-1', status: 'done', sourceHash: hexOf('c0de') }),
      )
      await media.put(EVENT, hashOf('c0de'), 'source', Uint8Array.of(1, 2))

      const report = await sweep()

      expect(report.collected).toBe(1)
      expect(await media.exists(EVENT, hashOf('c0de'), 'source')).toBe(false)
    })

    it('collects the source of a job the box abandoned, which is why that path may keep it', async () => {
      // `recoverClipJobs` deliberately leaves these: giving up after three interrupted
      // boots says something about the machine, not about the guest's video, and the
      // delete cannot be walked back. This is what makes that safe rather than a leak.
      clips.seed(
        aClipJob({
          id: 'job-1',
          eventId: 'event-1',
          status: 'failed',
          failureCode: 'clip.abandoned',
          sourceHash: hexOf('c0de'),
        }),
      )
      await media.put(EVENT, hashOf('c0de'), 'source', Uint8Array.of(1, 2))

      const report = await sweep()

      expect(report.collected).toBe(1)
    })

    it('sweeps every event the store holds bytes for', async () => {
      await media.put(EVENT, hashOf('a1'), 'display', Uint8Array.of(1))
      await media.put(OTHER, hashOf('b2'), 'display', Uint8Array.of(2))

      const report = await sweep()

      expect(report).toMatchObject({ scanned: 2, collected: 2 })
    })
  })

  describe('what it must never collect', () => {
    it('keeps a digest a photo row names', async () => {
      const photo = aPhoto({ id: 'photo-1', eventId: 'event-1' })
      photos.seed(photo)
      await media.put(EVENT, photo.contentHash, 'display', Uint8Array.of(1))

      const report = await sweep()

      expect(report).toMatchObject({ scanned: 1, collected: 0 })
      expect(await media.exists(EVENT, photo.contentHash, 'display')).toBe(true)
    })

    it('keeps a clip’s poster, which no row names as its content hash', async () => {
      // The poster is addressed by a second digest, and `findIdsReferencing` is what
      // knows that. A sweep asking only about `content_hash` would collect every poster
      // in the album on its first run.
      const clip = aClip({ id: 'photo-1', eventId: 'event-1' })
      photos.seed(clip)
      const facet = clip.facet
      expect(facet.kind).toBe('clip')
      if (facet.kind !== 'clip') return
      await media.put(EVENT, facet.posterHash, 'poster', Uint8Array.of(1))

      const report = await sweep()

      expect(report.collected).toBe(0)
      expect(await media.exists(EVENT, facet.posterHash, 'poster')).toBe(true)
    })

    it('keeps the source of a clip still waiting in the queue', async () => {
      // The whole point. A clip can sit behind twenty others for minutes, and this file
      // is the only copy of somebody's first dance.
      clips.seed(
        aClipJob({ id: 'job-1', eventId: 'event-1', status: 'queued', sourceHash: hexOf('c0de') }),
      )
      await media.put(EVENT, hashOf('c0de'), 'source', Uint8Array.of(1, 2))

      const report = await sweep()

      expect(report.collected).toBe(0)
      expect(await media.exists(EVENT, hashOf('c0de'), 'source')).toBe(true)
    })

    it('keeps the source of a clip being transcoded right now', async () => {
      clips.seed(
        aClipJob({ id: 'job-1', eventId: 'event-1', status: 'running', sourceHash: hexOf('c0de') }),
      )
      await media.put(EVENT, hashOf('c0de'), 'source', Uint8Array.of(1, 2))

      expect((await sweep()).collected).toBe(0)
    })

    it('keeps an object written moments ago, whatever the database says', async () => {
      // Every write path is bytes first, row second. Without this the sweep eats the
      // file out from under the insert that was about to name it — worse than the leak
      // it exists to fix, and reachable on any busy evening.
      written.set(atPlus(59 * 60 * 1000))
      await media.put(EVENT, hashOf('fed'), 'display', Uint8Array.of(1))

      const report = await sweep()

      expect(report).toMatchObject({ scanned: 1, collected: 0 })
      expect(await media.exists(EVENT, hashOf('fed'), 'display')).toBe(true)
    })

    it('judges a digest by its newest rendition, not its oldest', async () => {
      // A clip's video and poster are written moments apart. Judging them apart would
      // let one half go and leave the other, which is a broken tile rather than a leak.
      written.set(AT)
      await media.put(EVENT, hashOf('dad'), 'thumb', Uint8Array.of(1))
      written.set(atPlus(59 * 60 * 1000))
      await media.put(EVENT, hashOf('dad'), 'display', Uint8Array.of(2))

      const report = await sweep()

      expect(report.collected).toBe(0)
      expect(media.variantsOf(EVENT, hashOf('dad'))).toHaveLength(2)
    })

    it('does not collect a digest re-uploaded after the listing was taken', async () => {
      // **The snapshot hazard.** The listing and both name sets are read once per event
      // and acted on milliseconds later, and that is exactly long enough for a guest
      // whose clip was abandoned to send it again: `stage` inserts a reservation naming
      // this digest and `media.put` rewrites the same content-addressed path. Against the
      // snapshot both rules still said "collect", and the new job went `queued` pointing
      // at nothing — `clip.sourceMissing` is permanent, so the guest was told to send it
      // a third time.
      //
      // The re-upload is hooked onto the **last** of the batched reads, so every snapshot
      // this pass holds is already stale by the time it decides. Only the confirmation
      // immediately before the unlink can save it.
      await media.put(EVENT, hashOf('c0de'), 'source', Uint8Array.of(1, 2))
      const realSources = clips.listStagedSources.bind(clips)
      clips.listStagedSources = async (eventId) => {
        const staged = await realSources(eventId)
        clips.seed(
          aClipJob({
            id: 'job-1',
            eventId: 'event-1',
            status: 'reserved',
            sourceHash: hexOf('c0de'),
          }),
        )
        written.set(atPlus(60 * 60 * 1000))
        await media.put(EVENT, hashOf('c0de'), 'source', Uint8Array.of(3, 4, 5))
        return staged
      }

      const report = await sweep()

      expect(report.collected).toBe(0)
      expect(await media.exists(EVENT, hashOf('c0de'), 'source')).toBe(true)
    })

    it('does not collect a digest a row claimed after the listing was taken', async () => {
      // The other half of the same window: the row arrives but the bytes have not been
      // rewritten yet, so a freshness check alone would still say "collect".
      await media.put(EVENT, hashOf('c0de'), 'source', Uint8Array.of(1, 2))
      const realSources = clips.listStagedSources.bind(clips)
      clips.listStagedSources = async (eventId) => {
        const staged = await realSources(eventId)
        clips.seed(
          aClipJob({
            id: 'job-1',
            eventId: 'event-1',
            status: 'reserved',
            sourceHash: hexOf('c0de'),
          }),
        )
        return staged
      }

      expect((await sweep()).collected).toBe(0)
      expect(await media.exists(EVENT, hashOf('c0de'), 'source')).toBe(true)
    })

    it('does not collect a digest a photo row claimed after the listing was taken', async () => {
      // The same window, entered from the photo side rather than the queue: a clip
      // finishing transcode inserts its output row and the poster shares the source's
      // digest, so `photos` can start naming bytes this pass had already decided were
      // orphaned. `listReferencedDigests` was read before that row existed.
      await media.put(EVENT, hashOf('c0de'), 'source', Uint8Array.of(1, 2))
      const realSources = clips.listStagedSources.bind(clips)
      clips.listStagedSources = async (eventId) => {
        const staged = await realSources(eventId)
        photos.seed(aPhoto({ id: 'photo-9', eventId: 'event-1', contentHash: hexOf('c0de') }))
        return staged
      }

      expect((await sweep()).collected).toBe(0)
      expect(await media.exists(EVENT, hashOf('c0de'), 'source')).toBe(true)
    })

    it('does not count bytes that vanished between the listing and the unlink', async () => {
      // A purge, or an operator, can take the directory while the pass is walking it.
      // The digest is simply not this pass's to report: `collected` and `bytes` are the
      // numbers an operator reconciles against the disk, and counting a delete that did
      // not happen makes them fiction.
      await media.put(EVENT, hashOf('c0de'), 'source', Uint8Array.of(1, 2))
      const realSources = clips.listStagedSources.bind(clips)
      clips.listStagedSources = async (eventId) => {
        const staged = await realSources(eventId)
        await media.delete(EVENT, hashOf('c0de'))
        return staged
      }

      const report = await sweep()

      expect(report).toMatchObject({ scanned: 1, collected: 0, bytes: 0 })
    })

    it('never collects one event’s bytes because another event has no row for them', async () => {
      // The store is addressed by `(eventId, hash, variant)`, and two events genuinely
      // own separate copies of identical bytes. A sweep that asked the wrong event would
      // be a cross-tenant deletion.
      const photo = aPhoto({ id: 'photo-1', eventId: 'event-2' })
      photos.seed(photo)
      await media.put(OTHER, photo.contentHash, 'display', Uint8Array.of(1))

      expect((await sweep()).collected).toBe(0)
    })
  })

describe('what one pass costs', () => {
    it('stops at its budget and says which events it did not reach', async () => {
      // A pass walks the disk and holds the connection serving uploads and the projector.
      // An installation with more events than an interval can get through must not hold
      // it indefinitely — the next pass carries on, and the count is what makes a box that
      // never finishes visible rather than merely slow.
      await media.put(EVENT, hashOf('ab1'), 'display', Uint8Array.of(1))
      await media.put(OTHER, hashOf('b2'), 'display', Uint8Array.of(2))
      await media.put(THIRD, hashOf('cc3'), 'display', Uint8Array.of(3))
      build(FIFTEEN_MINUTES, 1)

      const report = await sweep()

      expect(report.scanned).toBe(1)
      expect(report.collected).toBe(1)
      // Both of the events it did not finish are counted: the one it stopped inside, and
      // the one it never opened.
      expect(report.skippedEvents).toBe(2)
    })

    it('starts the next pass where the last one stopped, so the tail is reached', async () => {
      // **The claim the old comment made and the code did not keep.** There was no
      // cursor: every pass began at element zero of `listEvents`, so on the box the
      // documentation itself cites — forty events of six thousand files — the tail was
      // reconciled never, and every leak the design deliberately creates there
      // accumulated until the event was purged.
      //
      // The first event is deliberately one the sweep *keeps*, so it is still in the list
      // on the second pass. That is the shape that starved the tail: an event nothing
      // collects is walked again and again while the one behind it is never reached.
      const kept = aPhoto({ id: 'photo-1', eventId: 'event-1' })
      photos.seed(kept)
      await media.put(EVENT, kept.contentHash, 'display', Uint8Array.of(1))
      await media.put(OTHER, hashOf('b2'), 'display', Uint8Array.of(2))
      build(FIFTEEN_MINUTES, 1)

      const first = await sweep()
      const second = await sweep()

      expect(first).toMatchObject({ scanned: 1, collected: 0, skippedEvents: 1 })
      expect(second.collected).toBe(1)
      expect(await media.exists(OTHER, hashOf('b2'), 'display')).toBe(false)
    })

    it('comes back round to the beginning once it has been through', async () => {
      // The cursor rotates rather than running off the end: a pass that reached the last
      // event starts again at the front, so a leak appearing in an event the cursor has
      // already passed is not waiting for a wrap that never comes.
      const kept = aPhoto({ id: 'photo-1', eventId: 'event-1' })
      photos.seed(kept)
      await media.put(EVENT, kept.contentHash, 'display', Uint8Array.of(1))
      await media.put(OTHER, hashOf('b2'), 'display', Uint8Array.of(2))
      build(FIFTEEN_MINUTES, 1)

      await sweep()
      await sweep()

      // The guest deletes that photo. Its bytes are now an orphan in the first event,
      // which the cursor has already gone past.
      await photos.delete(EVENT, kept.id)

      const third = await sweep()

      expect(third.collected).toBe(1)
      expect(await media.exists(EVENT, kept.contentHash, 'display')).toBe(false)
    })

    it('stops inside an event too, not only between events', async () => {
      // The budget is documented as "the most digests one pass will consider". Checked
      // only at the top of the event loop, one event with two hundred thousand digests
      // was walked in full and the policy's own sentence was false.
      for (const seed of ['aa1', 'bb2', 'cc3', 'dd4']) {
        await media.put(EVENT, hashOf(seed), 'display', Uint8Array.of(1))
      }
      build(FIFTEEN_MINUTES, 2)

      const report = await sweep()

      expect(report.scanned).toBe(2)
      expect(report.collected).toBe(2)
      expect(report.skippedEvents).toBe(1)
    })

    it('re-walks an event it was cut off inside, rather than skipping past it', async () => {
      // The other half of the rule above, and the constraint it puts on the budget. An
      // event cut off part-way does **not** move the cursor: the next pass starts at the
      // same event and finishes it. That is right — the alternative loses whatever was
      // behind the cut — but it means an event whose digests alone meet the budget is
      // never finished, and everything behind it starves for ever.
      //
      // `MEDIA_SWEEP_MAX_DIGESTS` carries that constraint: at the default quota an event
      // cannot hold fifty thousand digests, and an operator who raises the quota must
      // raise the budget with it.
      for (const seed of ['aa1', 'bb2', 'cc3', 'dd4']) {
        await media.put(EVENT, hashOf(seed), 'display', Uint8Array.of(1))
      }
      build(FIFTEEN_MINUTES, 2)

      await sweep()
      const second = await sweep()

      expect(second.collected).toBe(2)
      expect(await media.listEvents()).toEqual([])
    })

    it('asks the database nothing about an event whose objects it cannot name', async () => {
      // The filesystem store really can answer with an empty list for a directory that
      // exists: one holding only a `.tmp` from an interrupted `put`, which it reaps rather
      // than names. Two queries for an event with nothing to compare is work on the
      // connection that is also serving uploads.
      await media.put(EVENT, hashOf('ab1'), 'display', Uint8Array.of(1))
      media.list = async () => []
      let queries = 0
      const realDigests = photos.listReferencedDigests.bind(photos)
      photos.listReferencedDigests = async (eventId) => {
        queries += 1
        return realDigests(eventId)
      }

      const report = await sweep()

      expect(report.scanned).toBe(0)
      expect(queries).toBe(0)
    })


    it('asks the database once per event, not once per object', async () => {
      // The defect this replaced: one synchronous seek per digest, on the connection that
      // is also serving uploads. Forty events of six thousand files is eighty thousand of
      // them an hour, re-confirming what was referenced last pass too.
      for (const seed of ['aa1', 'bb2', 'cc3', 'dd4']) {
        await media.put(EVENT, hashOf(seed), 'display', Uint8Array.of(1))
      }
      let queries = 0
      const realDigests = photos.listReferencedDigests.bind(photos)
      photos.listReferencedDigests = async (eventId) => {
        queries += 1
        return realDigests(eventId)
      }

      const report = await sweep()

      expect(report.scanned).toBe(4)
      expect(queries).toBe(1)
    })
  })


  describe('when an event cannot be reconciled', () => {
    it('reports it and carries on with the rest', async () => {
      // A failure on one event is data the operator needs, not the job's outcome — the
      // same shape as the retention purge. One unreadable directory must not stop the
      // other forty.
      await media.put(EVENT, hashOf('a1'), 'display', Uint8Array.of(1))
      await media.put(OTHER, hashOf('b2'), 'display', Uint8Array.of(2))
      const realList = media.list.bind(media)
      media.list = async (eventId) => {
        if (eventId === EVENT) throw new Error('media root is unreadable')
        return realList(eventId)
      }

      const report = await sweep()

      expect(report.failed).toEqual([EVENT])
      expect(report.collected).toBe(1)
      expect(await media.exists(OTHER, hashOf('b2'), 'display')).toBe(false)
    })
  })

  describe('what it says', () => {
    it('says nothing when a healthy installation collects nothing', async () => {
      const photo = aPhoto({ id: 'photo-1', eventId: 'event-1' })
      photos.seed(photo)
      await media.put(EVENT, photo.contentHash, 'display', Uint8Array.of(1))

      await sweep()

      expect(logger.lines).toEqual([])
    })

    it('records a collection, because a figure here means a crash or a leak', async () => {
      await media.put(EVENT, hashOf('ab1'), 'display', Uint8Array.of(1))

      await sweep()

      expect(logger.lines.map((line) => line.level)).toEqual(['info'])
    })
  })

  describe('the leak it was written to collect, produced by the real path', () => {
    /**
     * **The link four comments assert and no test did.**
     *
     * Everything above seeds its own orphan, which proves the rule and not the wiring. So
     * this one makes a leak the way production makes one — a real `transcodeNextClip` that
     * gives up on a clip whose row the guest deleted under it, which leaves the source on
     * the disk precisely because the re-upload may already hold that digest — and then
     * runs the real sweep over it.
     */
    it('collects what the worker deliberately left, and nothing that is still named', async () => {
      const events = new FakeEventRepository()
      events.seed(anEvent({ id: 'event-1' }))
      const transcoder = new FakeVideoTranscoder()
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
      photos.chargeStagedBytesFrom(clips)

      // A clip staged and claimed, exactly as the upload path leaves it.
      const job = aClipJob({ id: 'job-1', eventId: 'event-1', sourceByteSize: 6_000 })
      await media.put(job.eventId, job.sourceHash, 'source', Uint8Array.of(1, 2, 3))
      clips.seed(job)

      // A published photograph, so the sweep has something it must not touch.
      const keeper = aPhoto({ id: 'photo-keeper', eventId: 'event-1' })
      photos.seed(keeper)
      await media.put(EVENT, keeper.contentHash, 'display', Uint8Array.of(9))

      const transcode = makeTranscodeNextClip({
        events,
        clips,
        photos,
        media,
        transcoder,
        hasher,
        bus: new RecordingEventBus(),
        clock: written,
        logger,
        policy: {
          maxHeight: 720,
          maxDurationMs: 15_000,
          maxOutputBytes: 40_000_000,
          posterMaxEdge: 480,
          maxPixels: 33_177_600,
        },
      })

      // The guest deletes their clip while it is being transcoded — which retires the
      // job, so the worker's write finds nothing and deliberately leaves the source.
      const claimed = await clips.claimNext(written.now())
      expect(claimed?.id).toBe('job-1')
      await clips.deleteForPhoto(EVENT, job.photoId)
      const outcome = await transcode()
      expect(outcome.ok).toBe(true)

      // The leak is real: bytes on the disk that no row names.
      expect(await media.exists(EVENT, job.sourceHash, 'source')).toBe(true)

      const report = await sweep()

      expect(report.collected).toBeGreaterThan(0)
      expect(await media.exists(EVENT, job.sourceHash, 'source')).toBe(false)
      // And the photograph nobody deleted is still there.
      expect(await media.exists(EVENT, keeper.contentHash, 'display')).toBe(true)
    })
  })
})
