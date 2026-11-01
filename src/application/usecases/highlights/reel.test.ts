import { beforeEach, describe, expect, it } from 'vitest'
import type { ClientCeilingsProps } from '../../../domain/clients/clientCeilings'
import { ContentHash } from '../../../domain/photos/contentHash'
import type { DomainError } from '../../../domain/shared/errors'
import { asEventId, asPhotoId, type EventId } from '../../../domain/shared/ids'
import type { Result } from '../../../domain/shared/result'
import {
  AT,
  aClient,
  aClip,
  aPhoto,
  anEvent,
  atPlus,
  type PhotoInput,
} from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { CountingClientRepository } from '../../testing/countingClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeContentHasher } from '../../testing/fakeContentHasher'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { FakeReelRenderer } from '../../testing/fakeReelRenderer'
import { FakeReelRepository } from '../../testing/fakeReelRepository'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeInvalidateReel, type InvalidateReel } from './invalidateReel'
import { makeRecoverReels } from './recoverReels'
import { makeRequestReel, type ReelRequestPolicy } from './requestReel'
import { makeTranscodeNextReel, type TranscodeNextReel } from './transcodeNextReel'

const EVENT = asEventId('event-1')
const OTHER = asEventId('event-2')
const DISPLAY = (id: string): Uint8Array => new TextEncoder().encode(`display-${id}`)

const POLICY: ReelRequestPolicy = {
  enabled: true,
  maxPhotos: 5,
  secondsPerPhoto: 4,
  maxOutputBytes: 1_000,
  maxQueued: 2,
}

const code = (result: Result<unknown, DomainError>): string | null =>
  result.ok ? null : result.error.code

const hashOf = (seed: string): ContentHash => {
  const made = ContentHash.create(seed.padEnd(64, '0').slice(0, 64))
  if (!made.ok) throw new Error('fixture')
  return made.value
}

describe('the highlight reel use cases (spec 08)', () => {
  let clients: CountingClientRepository
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let reels: FakeReelRepository
  let media: InMemoryMediaStore
  let renderer: FakeReelRenderer
  let bus: RecordingEventBus
  let clock: FakeClock
  let logger: CapturingLogger
  let policy: ReelRequestPolicy

  const makeRequest = (
    overrides: { renderer?: FakeReelRenderer; reels?: FakeReelRepository } = {},
  ) =>
    makeRequestReel({
      events,
      clients,
      photos,
      reels: overrides.reels ?? reels,
      renderer: overrides.renderer ?? renderer,
      media,
      bus,
      clock,
      logger,
      policy,
    })

  const makeTranscode = (
    overrides: {
      events?: Pick<FakeEventRepository, 'findById'>
      reels?: FakeReelRepository
      renderer?: FakeReelRenderer
    } = {},
  ): TranscodeNextReel =>
    makeTranscodeNextReel({
      events: overrides.events ?? events,
      clients,
      photos,
      reels: overrides.reels ?? reels,
      media,
      renderer: overrides.renderer ?? renderer,
      hasher: new FakeContentHasher(),
      bus,
      clock,
      logger,
      policy: { secondsPerPhoto: policy.secondsPerPhoto, maxOutputBytes: policy.maxOutputBytes },
    })

  const invalidate = (): InvalidateReel => makeInvalidateReel({ reels, media, clock, logger })

  beforeEach(() => {
    clients = new CountingClientRepository()
    events = new FakeEventRepository({ clients })
    photos = new FakePhotoRepository().chargeClientBytesFrom(clients)
    reels = new FakeReelRepository(photos)
    media = new InMemoryMediaStore()
    renderer = new FakeReelRenderer()
    bus = new RecordingEventBus()
    clock = new FakeClock(AT)
    logger = new CapturingLogger()
    policy = { ...POLICY }
    events.seed(
      anEvent({ id: 'event-1', slug: 'mariage', joinCode: 'AAAAAA' }),
      anEvent({ id: 'event-2', slug: 'gala', joinCode: 'BBBBBB' }),
    )
  })

  /** A published photograph, starred, with its display file on the disk. */
  const star = async (id: string, at = 0, input: PhotoInput = {}, eventId: EventId = EVENT) => {
    const photo = aPhoto({
      id,
      eventId,
      status: 'published',
      createdAt: atPlus(at),
      byteSize: 100,
      ...input,
    })
    photos.seed(photo)
    await photos.setHighlighted(eventId, photo.id, AT)
    await media.put(eventId, photo.contentHash, 'display', DISPLAY(id))
    return photo
  }

  const starThree = async (): Promise<void> => {
    await star('a', 0)
    await star('b', 1_000)
    await star('c', 2_000)
  }

  const asked = (eventId: EventId = EVENT) => makeRequest()({ eventId })

  /** An event of a client with these ceilings, with three starred photographs. */
  const CLIENT_EVENT = asEventId('event-c')
  const clientEvent = async (ceilings: Partial<ClientCeilingsProps>): Promise<void> => {
    clients.seed(aClient({ id: 'client-x', ceilings }))
    events.seed(
      anEvent({ id: 'event-c', slug: 'chez-client', joinCode: 'CCCCCC', clientId: 'client-x' }),
    )
    await star('ca', 0, {}, CLIENT_EVENT)
    await star('cb', 1_000, {}, CLIENT_EVENT)
    await star('cc', 2_000, {}, CLIENT_EVENT)
  }

  // ------------------------------------------------------------------------ request --

  describe('requestReel', () => {
    it('queues the favourites, oldest first, frozen now, and wakes the worker', async () => {
      await star('c', 2_000)
      await star('a', 0)
      await star('b', 1_000)
      await star('unstarred-later', 3_000, {})
      await photos.setHighlighted(EVENT, asPhotoId('unstarred-later'), null)

      const result = await asked()

      expect(result.ok && result.value.photoIds).toEqual(['a', 'b', 'c'])
      expect(result.ok && result.value.status).toBe('queued')
      expect(result.ok && result.value.id).toBe(EVENT)
      expect(bus.published).toEqual([{ type: 'reel.queued', eventId: EVENT }])
    })

    it('refuses an unknown event, a taken-down one, a suspended client and an archived event', async () => {
      await starThree()
      expect(code(await makeRequest()({ eventId: asEventId('ghost') }))).toBe('event.notFound')

      await events.setTakenDown(EVENT, AT)
      expect(code(await asked())).toBe('event.notFound')
      await events.setTakenDown(EVENT, null)

      events.seed(anEvent({ id: 'event-1', clientSuspendedAt: AT }))
      expect(code(await asked())).toBe('client.suspended')

      events.seed(anEvent({ id: 'event-1', status: 'archived' }))
      expect(code(await asked())).toBe('event.immutable')
      expect(bus.published).toEqual([])
    })

    it('is switched off by REEL_ENABLED, refused to a client with no video, and needs an encoder', async () => {
      await starThree()
      policy = { ...policy, enabled: false }
      expect(code(await asked())).toBe('reel.notAllowed')
      policy = { ...policy, enabled: true }

      await clientEvent({ clipsAllowed: false })
      expect(code(await asked(CLIENT_EVENT))).toBe('reel.notAllowed')

      const noEncoder = makeRequest({ renderer: new FakeReelRenderer({ available: false }) })
      expect(code(await noEncoder({ eventId: EVENT }))).toBe('reel.transcoderUnavailable')
    })

    it('answers reel.notEnoughPhotos below three, a clip not counting, and on a draft with nothing', async () => {
      await star('a', 0)
      await star('b', 1_000)
      photos.seed(aClip({ id: 'clip', eventId: 'event-1', status: 'published', createdAt: AT }))
      await photos.setHighlighted(EVENT, asPhotoId('clip'), AT)

      expect(code(await asked())).toBe('reel.notEnoughPhotos')
    })

    it('answers reel.tooManyPhotos past the maximum, and cuts nothing short', async () => {
      policy = { ...policy, maxPhotos: 2 }
      await starThree()

      expect(code(await asked())).toBe('reel.tooManyPhotos')
      expect(await reels.findByEvent(EVENT)).toBeNull()
    })

    it('reads every page of favourites when there are more than one', async () => {
      policy = { ...policy, maxPhotos: 500 }
      for (let index = 0; index < 205; index += 1) await star(`p${index}`, index * 10)

      const result = await asked()

      expect(result.ok && result.value.photoIds).toHaveLength(205)
    })

    it('refuses a second request while one is queued or running, and when the row races it', async () => {
      await starThree()
      await asked()

      expect(code(await asked())).toBe('reel.alreadyRunning')

      const blind = Object.create(reels, {
        findByEvent: { value: async () => null },
      }) as FakeReelRepository
      expect(code(await makeRequest({ reels: blind })({ eventId: EVENT }))).toBe(
        'reel.alreadyRunning',
      )
    })

    it('refuses with reel.queueFull, and a retry hint, when the box queues too many', async () => {
      await starThree()
      policy = { ...policy, maxQueued: 0 }

      const result = await asked()

      expect(code(result)).toBe('reel.queueFull')
      expect(!result.ok && result.error.details).toMatchObject({ depth: 0, maxDepth: 0 })
    })

    it('refuses with event.quotaExceeded when the event cannot hold the largest montage', async () => {
      await starThree()
      events.seed(anEvent({ id: 'event-1', quotaBytes: 300 + 999 }))

      const result = await asked()

      expect(code(result)).toBe('event.quotaExceeded')
      expect(await reels.findByEvent(EVENT)).toBeNull()
    })

    it('refuses with client.storageFull when the client cannot hold it', async () => {
      await clientEvent({ maxTotalBytes: 300 + 999 })

      expect(code(await asked(CLIENT_EVENT))).toBe('client.storageFull')
    })

    it('replaces a finished montage: the old file goes at once, the row is reused', async () => {
      await starThree()
      await asked()
      const job = await reels.claimNext(AT)
      if (job === null) throw new Error('fixture')
      await media.put(EVENT, hashOf('0d1'), 'reel', Uint8Array.of(1, 2))
      await reels.finish(job, { hash: hashOf('0d1'), byteSize: 2, durationMs: 12_000 }, ROOMY, AT)
      bus.clear()

      const again = await asked()

      expect(again.ok && again.value.status).toBe('queued')
      expect(await media.exists(EVENT, hashOf('0d1'), 'reel')).toBe(false)
      expect((await reels.findByEvent(EVENT))?.output).toBeNull()
      expect(bus.published).toHaveLength(1)
    })

    it('goes on, and says so, when the old file will not go', async () => {
      await starThree()
      await asked()
      const job = await reels.claimNext(AT)
      if (job === null) throw new Error('fixture')
      await media.put(EVENT, hashOf('0d1'), 'reel', Uint8Array.of(1, 2))
      await reels.finish(job, { hash: hashOf('0d1'), byteSize: 2, durationMs: 12_000 }, ROOMY, AT)
      media.failDeletes()

      const again = await asked()

      expect(again.ok).toBe(true)
      expect(logger.lines.some((line) => line.level === 'warn')).toBe(true)
    })
  })

  // ----------------------------------------------------------------------- transcode --

  describe('transcodeNextReel', () => {
    const ready = async (): Promise<void> => {
      await starThree()
      await asked()
      bus.clear()
    }

    it('is idle when nothing is queued', async () => {
      const result = await makeTranscode()()

      expect(result.ok && result.value.kind).toBe('idle')
    })

    it('renders the frames oldest first, stores the file, and marks the row done', async () => {
      await ready()

      const result = await makeTranscode()()

      expect(result.ok && result.value).toEqual({ kind: 'rendered', eventId: EVENT })
      expect(renderer.rendered).toHaveLength(1)
      expect(renderer.rendered[0]?.map((frame) => new TextDecoder().decode(frame))).toEqual([
        'display-a',
        'display-b',
        'display-c',
      ])
      const row = await reels.findByEvent(EVENT)
      expect([row?.status, row?.output?.durationMs]).toEqual(['done', 12_000])
      if (row?.output === null || row === null) throw new Error('fixture')
      expect(await media.exists(EVENT, row.output.hash, 'reel')).toBe(true)
      expect(bus.published).toEqual([])
    })

    it('gives up for good when the event is gone, and keeps nothing', async () => {
      await ready()
      const gone = { findById: async () => null }

      const result = await makeTranscode({ events: gone })()

      expect(result.ok && result.value).toMatchObject({ kind: 'failed', code: 'event.notFound' })
      expect((await reels.findByEvent(EVENT))?.status).toBe('failed')
      expect(renderer.rendered).toEqual([])
    })

    it.each([
      ['taken down by the operator', () => events.setTakenDown(EVENT, AT)],
      [
        'a suspended client',
        async () => {
          events.seed(anEvent({ id: 'event-1', clientSuspendedAt: AT }))
        },
      ],
      [
        'archived',
        async () => {
          events.seed(anEvent({ id: 'event-1', status: 'archived' }))
        },
      ],
    ] as const)(
      'makes nothing for an event that is %s: reel.eventUnavailable, no file',
      async (_name, change) => {
        await ready()
        await change()

        const result = await makeTranscode()()

        expect(result.ok && result.value).toMatchObject({
          kind: 'failed',
          code: 'reel.eventUnavailable',
          willRetry: false,
        })
        expect(renderer.rendered).toEqual([])
        expect(bus.published).toEqual([
          { type: 'reel.failed', eventId: EVENT, code: 'reel.eventUnavailable' },
        ])
      },
    )

    it('gives up on a client whose plan stopped including video', async () => {
      await clientEvent({})
      await asked(CLIENT_EVENT)
      clients.seed(aClient({ id: 'client-x', ceilings: { clipsAllowed: false } }))

      const result = await makeTranscode()()

      expect(result.ok && result.value).toMatchObject({ kind: 'failed', code: 'reel.notAllowed' })
    })

    it('makes the montage stale, not shorter, when a photograph left before it was taken', async () => {
      await ready()
      await photos.updateStatuses(EVENT, [asPhotoId('b')], 'hidden', { kind: 'automatic', at: AT })

      const result = await makeTranscode()()

      expect(result.ok && result.value.kind).toBe('stale')
      expect((await reels.findByEvent(EVENT))?.status).toBe('stale')
      expect(renderer.rendered).toEqual([])
    })

    it('makes the montage stale when a photograph was deleted before it was taken', async () => {
      await ready()
      await photos.delete(EVENT, asPhotoId('c'))

      const result = await makeTranscode()()

      expect(result.ok && result.value.kind).toBe('stale')
    })

    it('skips a photograph whose file is missing, and fails below three', async () => {
      await ready()
      const missing = await photos.findById(EVENT, asPhotoId('a'))
      if (missing === null) throw new Error('fixture')
      await media.delete(EVENT, missing.contentHash)

      const result = await makeTranscode()()

      expect(result.ok && result.value).toMatchObject({
        kind: 'failed',
        code: 'reel.notEnoughPhotos',
      })
      expect(logger.lines.some((line) => line.message.includes('no stored file'))).toBe(true)
    })

    it('still makes the montage from the photographs that have a file, when three remain', async () => {
      await starThree()
      await star('d', 3_000)
      await asked()
      const missing = await photos.findById(EVENT, asPhotoId('a'))
      if (missing === null) throw new Error('fixture')
      await media.delete(EVENT, missing.contentHash)

      const result = await makeTranscode()()

      expect(result.ok && result.value.kind).toBe('rendered')
      expect(renderer.rendered[0]).toHaveLength(3)
    })

    it('tries again later when there is no encoder, and when the encoder fails', async () => {
      await ready()

      const noEncoder = await makeTranscode({
        renderer: new FakeReelRenderer({ available: false }),
      })()
      expect(noEncoder.ok && noEncoder.value).toMatchObject({
        code: 'reel.transcoderUnavailable',
        willRetry: true,
      })

      clock.advance(60_000)
      const broken = await makeTranscode({
        renderer: new FakeReelRenderer({ failsWith: 'reel.renderFailed' }),
      })()
      expect(broken.ok && broken.value).toMatchObject({
        code: 'reel.renderFailed',
        willRetry: true,
      })
      expect((await reels.findByEvent(EVENT))?.status).toBe('queued')
    })

    it('gives up after the third failed attempt, and says so on the bus', async () => {
      await ready()
      const broken = makeTranscode({
        renderer: new FakeReelRenderer({ failsWith: 'reel.timedOut' }),
      })

      for (let attempt = 0; attempt < 3; attempt += 1) {
        clock.advance(60_000)
        await broken()
      }

      expect((await reels.findByEvent(EVENT))?.status).toBe('failed')
      expect(bus.published).toEqual([
        { type: 'reel.failed', eventId: EVENT, code: 'reel.timedOut' },
      ])
    })

    it('removes the file and retries when the store cannot keep it', async () => {
      await ready()
      media.failWritesAfter(0)

      const result = await makeTranscode()()

      expect(result.ok && result.value).toMatchObject({
        code: 'reel.storageFailed',
        willRetry: true,
      })
    })

    it('fails on a digest the domain refuses', async () => {
      await ready()
      const garbage = makeTranscodeNextReel({
        events,
        clients,
        photos,
        reels,
        media,
        renderer,
        hasher: new FakeContentHasher().returnGarbage(),
        bus,
        clock,
        logger,
        policy: { secondsPerPhoto: 4, maxOutputBytes: 1_000 },
      })

      const result = await garbage()

      expect(result.ok && result.value).toMatchObject({ code: 'reel.storageFailed' })
    })

    it('deletes what it wrote and keeps nothing when the event was taken down while it rendered', async () => {
      await ready()
      const during = makeTranscode({
        renderer: new FakeReelRenderer({ whileRendering: () => events.setTakenDown(EVENT, AT) }),
      })

      const result = await during()

      expect(result.ok && result.value).toMatchObject({
        code: 'reel.eventUnavailable',
        willRetry: false,
      })
      expect(await media.usedBytes(EVENT)).toBe(await bytesOfDisplays())
    })

    it('fails with event.notFound when the event vanished while it rendered', async () => {
      await ready()
      let reads = 0
      const vanishing = {
        findById: async (id: EventId) => (reads++ === 0 ? events.findById(id) : null),
      }

      const result = await makeTranscode({ events: vanishing })()

      expect(result.ok && result.value).toMatchObject({ code: 'event.notFound' })
    })

    it('makes the montage stale, and deletes the file, when a photograph left while it rendered', async () => {
      await ready()
      const during = makeTranscode({
        renderer: new FakeReelRenderer({
          whileRendering: async () => {
            await photos.updateStatuses(EVENT, [asPhotoId('a')], 'rejected', {
              kind: 'automatic',
              at: AT,
            })
          },
        }),
      })

      const result = await during()

      expect(result.ok && result.value.kind).toBe('stale')
      expect((await reels.findByEvent(EVENT))?.status).toBe('stale')
      expect(await media.usedBytes(EVENT)).toBe(await bytesOfDisplays())
    })

    it('does not bring a montage back to life when the invalidation reached the row first', async () => {
      await ready()
      const during = makeTranscode({
        renderer: new FakeReelRenderer({
          whileRendering: () => invalidate()(EVENT, [asPhotoId('a')]),
        }),
      })

      const result = await during()

      expect(result.ok && result.value.kind).toBe('stale')
      expect((await reels.findByEvent(EVENT))?.status).toBe('stale')
      expect((await reels.findByEvent(EVENT))?.output).toBeNull()
    })

    it('treats a row purged while it rendered as stale, and keeps no file', async () => {
      await ready()
      const purged = Object.create(reels, {
        finish: { value: async () => ({ kind: 'gone' }) },
      }) as FakeReelRepository

      const result = await makeTranscode({ reels: purged })()

      expect(result.ok && result.value.kind).toBe('stale')
      expect(await media.usedBytes(EVENT)).toBe(await bytesOfDisplays())
    })

    it('deletes the file and gives up when the event cannot hold it any more', async () => {
      await ready()
      events.seed(anEvent({ id: 'event-1', quotaBytes: 300 + 5 }))

      const result = await makeTranscode()()

      expect(result.ok && result.value).toMatchObject({
        code: 'event.quotaExceeded',
        willRetry: false,
      })
      expect(await media.usedBytes(EVENT)).toBe(await bytesOfDisplays())
    })

    it('says client.storageFull when the client cannot hold it', async () => {
      await clientEvent({})
      await asked(CLIENT_EVENT)
      clients.seed(aClient({ id: 'client-x', ceilings: { maxTotalBytes: 300 + 5 } }))

      const result = await makeTranscode()()

      expect(result.ok && result.value).toMatchObject({ code: 'client.storageFull' })
    })

    it('does not save a failure over a row an invalidation already spoiled', async () => {
      await ready()
      // The invalidation reaches the row just before the worker's own write of the failure.
      const spoiledFirst = Object.create(reels, {
        save: {
          value: async (job: Parameters<FakeReelRepository['save']>[0]) => {
            await invalidate()(EVENT, [asPhotoId('a')])
            return reels.save(job)
          },
        },
      }) as FakeReelRepository

      const result = await makeTranscode({
        reels: spoiledFirst,
        renderer: new FakeReelRenderer({ failsWith: 'reel.renderFailed' }),
      })()

      expect(result.ok && result.value).toMatchObject({ willRetry: false })
      expect((await reels.findByEvent(EVENT))?.status).toBe('stale')
    })

    const bytesOfDisplays = async (): Promise<number> => {
      let total = 0
      for (const id of ['a', 'b', 'c', 'd']) total += DISPLAY(id).length * (await has(id))
      return total
    }
    const has = async (id: string): Promise<number> => {
      const photo = await photos.findById(EVENT, asPhotoId(id))
      return photo !== null && (await media.exists(EVENT, photo.contentHash, 'display')) ? 1 : 0
    }
  })

  // ------------------------------------------------------------------------ invalidate --

  describe('invalidateReel', () => {
    const makeDone = async (): Promise<ContentHash> => {
      await starThree()
      await asked()
      await makeTranscode()()
      const row = await reels.findByEvent(EVENT)
      if (row?.output === null || row === null) throw new Error('fixture')
      return row.output.hash
    }

    it('makes a finished montage stale, deletes its file, then lets the row go of it', async () => {
      const hash = await makeDone()

      await invalidate()(EVENT, [asPhotoId('b')])

      const row = await reels.findByEvent(EVENT)
      expect([row?.status, row?.output]).toEqual(['stale', null])
      expect(await media.exists(EVENT, hash, 'reel')).toBe(false)
      expect(await reels.reelBytes(EVENT)).toBe(0)
    })

    it('stales a montage that is still queued, with no file to delete', async () => {
      await starThree()
      await asked()

      await invalidate()(EVENT, [asPhotoId('a')])

      expect((await reels.findByEvent(EVENT))?.status).toBe('stale')
    })

    it('does nothing for a photograph the montage does not hold, another event, or an empty batch', async () => {
      await makeDone()

      await invalidate()(EVENT, [asPhotoId('stranger')])
      await invalidate()(OTHER, [asPhotoId('a')])
      await invalidate()(EVENT, [])

      expect((await reels.findByEvent(EVENT))?.status).toBe('done')
    })

    it('leaves a stale row naming its file, and does not throw, when the file will not go', async () => {
      const hash = await makeDone()
      media.failDeletes()

      await expect(invalidate()(EVENT, [asPhotoId('a')])).resolves.toBeUndefined()

      const row = await reels.findByEvent(EVENT)
      expect([row?.status, row?.output?.hash.value]).toEqual(['stale', hash.value])
      expect(logger.lines.some((line) => line.level === 'warn')).toBe(true)
    })
  })

  // --------------------------------------------------------------------------- recover --

  describe('recoverReels', () => {
    const recover = () => makeRecoverReels({ reels, media, clock, logger })()

    it('puts a montage the dead process was rendering back in the queue', async () => {
      await starThree()
      await asked()
      await reels.claimNext(AT)

      const report = await recover()

      expect(report).toEqual({ requeued: 1, cleaned: 0 })
      expect((await reels.findByEvent(EVENT))?.status).toBe('queued')
    })

    it('finishes a retirement the crash interrupted: a stale montage still naming its file', async () => {
      await starThree()
      await asked()
      await makeTranscode()()
      const done = await reels.findByEvent(EVENT)
      const hash = done?.output?.hash
      if (hash === undefined) throw new Error('fixture')
      await reels.invalidate(EVENT, [asPhotoId('a')], AT)

      const report = await recover()

      expect(report).toEqual({ requeued: 0, cleaned: 1 })
      expect(await media.exists(EVENT, hash, 'reel')).toBe(false)
      expect((await reels.findByEvent(EVENT))?.output).toBeNull()
    })

    it('says nothing when there is nothing to do, and logs and goes on when a file will not go', async () => {
      expect(await recover()).toEqual({ requeued: 0, cleaned: 0 })

      await starThree()
      await asked()
      await makeTranscode()()
      await reels.invalidate(EVENT, [asPhotoId('a')], AT)
      media.failDeletes()

      expect(await recover()).toEqual({ requeued: 0, cleaned: 0 })
      expect(logger.lines.some((line) => line.level === 'warn')).toBe(true)
    })
  })
})

const ROOMY = { quotaBytes: 1_000_000, clientBytes: null }
