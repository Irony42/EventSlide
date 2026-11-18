import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '../../../domain/clients/client'
import { Event } from '../../../domain/events/event'
import { requestExport } from '../../../domain/exports/albumExport'
import { aClient, anEvent, atPlus } from '../../testing/builders'
import {
  DEFAULT_EXPORT_POLICY,
  EXPORT_EVENT,
  EXPORT_HOST,
  ExportScene,
  type ExportScenePolicy,
} from '../../testing/exportScene'
import { makeRequestAlbumExport, type RequestAlbumExport } from './requestAlbumExport'

/**
 * Asking for the verified archive (spec 22). Every refusal is tested for what it **did not write**:
 * the row, the file and the signal that wakes the worker are all absent.
 */

let scene: ExportScene
let request: RequestAlbumExport

const wire = (
  policy: ExportScenePolicy = DEFAULT_EXPORT_POLICY,
  event?: Event,
  clients: readonly Client[] = [],
): void => {
  scene = new ExportScene(policy, event, clients)
  request = makeRequestAlbumExport({
    events: scene.events,
    clients: scene.clients,
    photos: scene.photos,
    voices: scene.voices,
    exports: scene.exports,
    exportFiles: scene.exportFiles,
    bus: scene.bus,
    clock: scene.clock,
    logger: scene.logger,
    freeDiskBytes: scene.freeDiskBytes,
    policy,
  })
}

const ask = () => request({ eventId: EXPORT_EVENT, actorId: EXPORT_HOST })

const expectNothingWritten = async (): Promise<void> => {
  expect(await scene.exports.find(EXPORT_EVENT)).toBeNull()
  expect(scene.bus.published).toEqual([])
}

beforeEach(() => wire())

describe('requestAlbumExport', () => {
  describe('an archive that is asked for', () => {
    it('is queued, remembers who asked and when, and wakes the worker', async () => {
      const result = await ask()

      expect(result.ok && result.value).toMatchObject({
        status: 'queued',
        requestedBy: EXPORT_HOST,
        requestedAt: scene.clock.now(),
      })
      expect(await scene.exports.find(EXPORT_EVENT)).toMatchObject({ status: 'queued' })
      expect(scene.bus.published).toEqual([{ type: 'export.changed', eventId: EXPORT_EVENT }])
    })

    it('is allowed for an archived event as well as a closed one', async () => {
      wire(DEFAULT_EXPORT_POLICY, anEvent({ id: 'event-1', status: 'archived' }))

      expect((await ask()).ok).toBe(true)
    })

    it('replaces the archive that was there, and deletes its file at once', async () => {
      scene.exportFiles.seed(EXPORT_EVENT, new Uint8Array([1]))
      const old = requestExport(EXPORT_EVENT, EXPORT_HOST, atPlus(0))
      await scene.exports.request(old)
      await scene.exports.claimNext(atPlus(1))
      await scene.exports.finish(
        EXPORT_EVENT,
        {
          kind: 'sealed',
          seal: {
            entries: 1,
            skipped: 0,
            bytes: 1,
            sha256: 'a'.repeat(64),
            expiresAt: atPlus(1e9),
          },
        },
        atPlus(2),
      )

      const result = await ask()

      expect(result.ok).toBe(true)
      expect(await scene.exports.find(EXPORT_EVENT)).toMatchObject({
        status: 'queued',
        sha256: null,
      })
      expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(false)
    })

    it('still queues the new one when the old file cannot be deleted, and says so', async () => {
      scene.exportFiles.delete = async () => {
        throw new Error('EBUSY')
      }

      const result = await ask()

      expect(result.ok).toBe(true)
      expect(scene.logger.lines.some((line) => line.level === 'warn')).toBe(true)
    })
  })

  describe('who may ask', () => {
    it('answers an unknown event as not found', async () => {
      const result = await request({ eventId: asId('nope'), actorId: EXPORT_HOST })

      expect(!result.ok && result.error.code).toBe('event.notFound')
    })

    it('answers an event the operator took down as not found, and writes nothing', async () => {
      await scene.events.setTakenDown(EXPORT_EVENT, atPlus(0))

      const result = await ask()

      expect(!result.ok && result.error.code).toBe('event.notFound')
      await expectNothingWritten()
    })

    it('refuses a suspended client that is not being offboarded with client.suspended', async () => {
      wire(DEFAULT_EXPORT_POLICY, suspendedEvent(), [
        aClient({ id: 'client-1', suspendedAt: atPlus(0), purgeAfter: null }),
      ])

      const result = await ask()

      expect(!result.ok && result.error.code).toBe('client.suspended')
      await expectNothingWritten()
    })

    it('accepts a suspended client that is being offboarded: the grace period is for exporting', async () => {
      wire(DEFAULT_EXPORT_POLICY, suspendedEvent(), [
        aClient({ id: 'client-1', suspendedAt: atPlus(0), purgeAfter: atPlus(30 * 86_400_000) }),
      ])

      expect((await ask()).ok).toBe(true)
    })

    it('still refuses an event the operator took down, offboarding or not', async () => {
      wire(DEFAULT_EXPORT_POLICY, suspendedEvent(), [
        aClient({ id: 'client-1', suspendedAt: atPlus(0), purgeAfter: atPlus(30 * 86_400_000) }),
      ])
      await scene.events.setTakenDown(EXPORT_EVENT, atPlus(0))

      const result = await ask()

      expect(!result.ok && result.error.code).toBe('event.notFound')
    })
  })

  describe('what is refused before anything is written', () => {
    it('refuses when the function is off for the box, with export.unavailable', async () => {
      wire({ ...DEFAULT_EXPORT_POLICY, enabled: false })

      const result = await ask()

      expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
        'unexpected',
        'export.unavailable',
      ])
      await expectNothingWritten()
    })

    it.each(['draft', 'live'] as const)(
      'refuses an event that is %s: the album still grows',
      async (status) => {
        wire(DEFAULT_EXPORT_POLICY, anEvent({ id: 'event-1', status }))

        const result = await ask()

        expect(!result.ok && result.error.code).toBe('export.notClosed')
        await expectNothingWritten()
      },
    )

    it.each(['queued', 'running'] as const)(
      'refuses a second request while the first is %s',
      async (status) => {
        await ask()
        if (status === 'running') await scene.exports.claimNext(scene.clock.now())
        scene.bus.published.length = 0

        const result = await ask()

        expect(!result.ok && result.error.code).toBe('export.alreadyRunning')
        expect(scene.bus.published).toEqual([])
      },
    )

    it('lets a host ask again once the archive has failed or went stale', async () => {
      await ask()

      for (const verdict of [
        { kind: 'failed', code: 'noRoom' },
        { kind: 'stale', reason: 'albumChanged' },
      ] as const) {
        await scene.exports.claimNext(scene.clock.now())
        await scene.exports.finish(EXPORT_EVENT, verdict, scene.clock.now())

        expect((await ask()).ok, verdict.kind).toBe(true)
      }
    })
  })

  describe('the daily ceiling (three preparations per event per day)', () => {
    const askThree = async (): Promise<void> => {
      for (let n = 0; n < 3; n += 1) {
        expect((await ask()).ok).toBe(true)
        await scene.exports.claimNext(scene.clock.now())
        await scene.exports.finish(
          EXPORT_EVENT,
          { kind: 'failed', code: 'unexpected' },
          scene.clock.now(),
        )
        scene.clock.advance(60_000)
      }
    }

    it('refuses the fourth request of the day before anything is written', async () => {
      await askThree()
      const before = await scene.exports.find(EXPORT_EVENT)
      scene.bus.published.length = 0

      const fourth = await ask()

      expect(!fourth.ok && [fourth.error.kind, fourth.error.code]).toEqual([
        'rateLimited',
        'export.dailyLimitReached',
      ])
      expect(await scene.exports.find(EXPORT_EVENT)).toEqual(before)
      expect(scene.bus.published).toEqual([])
    })

    it('says how long to wait: until the oldest request of the day leaves the window', async () => {
      await askThree()

      const fourth = await ask()

      // The first request was made 3 minutes ago: 24 h minus 3 min remain.
      expect(!fourth.ok && fourth.error.details).toEqual({
        max: 3,
        retryAfterSeconds: 24 * 3600 - 3 * 60,
      })
    })

    it('counts a deleted archive’s requests: removing the row does not buy a fresh day', async () => {
      await askThree()
      await scene.exports.delete(EXPORT_EVENT)

      const result = await ask()

      expect(!result.ok && result.error.code).toBe('export.dailyLimitReached')
    })

    it('allows another request once the day has passed', async () => {
      await askThree()
      scene.clock.advance(24 * 3_600_000)

      expect((await ask()).ok).toBe(true)
    })

    it('does not count another event’s requests', async () => {
      await scene.exports.request(requestExport(asId('event-2'), EXPORT_HOST, scene.clock.now()))
      await scene.exports.request(requestExport(asId('event-2'), EXPORT_HOST, scene.clock.now()))
      await scene.exports.request(requestExport(asId('event-2'), EXPORT_HOST, scene.clock.now()))

      expect((await ask()).ok).toBe(true)
    })
  })

  describe('the room (spec 22, section 9)', () => {
    /** Three published photographs of 1 000 bytes each: an estimate of 3 000 + 3 × 100. */
    const seedAlbum = async (): Promise<void> => {
      for (const id of ['p1', 'p2', 'p3']) await scene.photo({ id, byteSize: 1_000 })
    }
    const ESTIMATE = 3_000 + 3 * 100

    it('refuses with export.noRoom when the free disk cannot hold it and the minimum', async () => {
      await seedAlbum()
      scene.freeDisk = ESTIMATE + DEFAULT_EXPORT_POLICY.minFreeDiskBytes - 1

      const result = await ask()

      expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
        'conflict',
        'export.noRoom',
      ])
      await expectNothingWritten()
    })

    it('counts the voice messages in the estimate: the disk that holds the photographs alone is refused (spec 25)', async () => {
      await seedAlbum()
      await scene.voice({ id: 'v1', audioByteSize: 2_000 })
      scene.freeDisk = ESTIMATE + DEFAULT_EXPORT_POLICY.minFreeDiskBytes

      const result = await ask()

      expect(!result.ok && result.error.code).toBe('export.noRoom')
      await expectNothingWritten()
    })

    it('refuses with export.tooLarge an archive that fits the ceiling only without its recordings', async () => {
      wire({ ...DEFAULT_EXPORT_POLICY, maxBytes: ESTIMATE })
      await seedAlbum()
      await scene.voice({ id: 'v1', audioByteSize: 2_000 })

      const result = await ask()

      expect(!result.ok && result.error.code).toBe('export.tooLarge')
      await expectNothingWritten()
    })

    it('accepts when exactly that much is free', async () => {
      await seedAlbum()
      scene.freeDisk = ESTIMATE + DEFAULT_EXPORT_POLICY.minFreeDiskBytes

      expect((await ask()).ok).toBe(true)
    })

    it('refuses a disk that cannot be read: never assume there is room', async () => {
      await seedAlbum()
      scene.freeDisk = null

      const result = await ask()

      expect(!result.ok && result.error.code).toBe('export.noRoom')
      await expectNothingWritten()
    })

    it('refuses an archive over EXPORT_MAX_BYTES with export.tooLarge (413)', async () => {
      await seedAlbum()
      wire({ ...DEFAULT_EXPORT_POLICY, maxBytes: ESTIMATE - 1 })
      await seedAlbum()

      const result = await ask()

      expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
        'quotaExceeded',
        'export.tooLarge',
      ])
      await expectNothingWritten()
    })

    it('accepts an archive of exactly EXPORT_MAX_BYTES', async () => {
      wire({ ...DEFAULT_EXPORT_POLICY, maxBytes: ESTIMATE })
      await seedAlbum()

      expect((await ask()).ok).toBe(true)
    })

    it('refuses an archive that would take the box past EXPORT_MAX_TOTAL_BYTES', async () => {
      wire({ ...DEFAULT_EXPORT_POLICY, maxTotalBytes: ESTIMATE + 4_999 })
      await seedAlbum()
      await sealOtherEvent(5_000)

      const result = await ask()

      expect(!result.ok && result.error.code).toBe('export.noRoom')
      await expectNothingWritten()
    })

    it('counts an archive in the making by its temporary file, which has no sealed size yet', async () => {
      wire({ ...DEFAULT_EXPORT_POLICY, maxTotalBytes: ESTIMATE + 4_999 })
      await seedAlbum()
      scene.exportFiles.seedTemporary('event-9.1.tmp', 5_000, scene.clock.now())

      const result = await ask()

      expect(!result.ok && result.error.code).toBe('export.noRoom')
    })

    it('accepts when the archives already on the box leave exactly that much room', async () => {
      wire({ ...DEFAULT_EXPORT_POLICY, maxTotalBytes: ESTIMATE + 5_000 })
      await seedAlbum()
      await sealOtherEvent(5_000)

      expect((await ask()).ok).toBe(true)
    })

    it('counts every photograph, clip and the rows of the album, not rejected ones', async () => {
      await scene.photo({ id: 'kept', byteSize: 1_000 })
      await scene.photo({ id: 'hidden', status: 'hidden', byteSize: 1_000 })
      wire({ ...DEFAULT_EXPORT_POLICY, maxBytes: 2_000 + 2 * 100 })
      await scene.photo({ id: 'kept', byteSize: 1_000 })
      await scene.photo({ id: 'hidden', status: 'hidden', byteSize: 1_000 })
      await scene.photo({ id: 'rejected', status: 'rejected', byteSize: 50 })

      // Rejected photographs are in the stored bytes (they weigh on the disk) but not in the rows.
      const result = await ask()

      expect(!result.ok && result.error.code).toBe('export.tooLarge')
    })
  })
})

const asId = (value: string) => value as typeof EXPORT_EVENT

const suspendedEvent = (): Event =>
  Event.restore({
    ...anEvent({ id: 'event-1', status: 'closed', clientId: 'client-1' }).toProps(),
    clientSuspendedAt: atPlus(0),
  })

/** Another event's sealed archive of this many bytes, on the same box. */
const sealOtherEvent = async (bytes: number): Promise<void> => {
  const other = asId('event-2')
  await scene.exports.request(requestExport(other, EXPORT_HOST, atPlus(0)))
  await scene.exports.claimNext(atPlus(1))
  await scene.exports.finish(
    other,
    {
      kind: 'sealed',
      seal: { entries: 1, skipped: 0, bytes, sha256: 'a'.repeat(64), expiresAt: atPlus(1e9) },
    },
    atPlus(2),
  )
}
