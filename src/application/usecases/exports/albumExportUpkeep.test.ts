import { beforeEach, describe, expect, it } from 'vitest'
import { requestExport, type ExportSeal } from '../../../domain/exports/albumExport'
import { asEventId } from '../../../domain/shared/ids'
import { atPlus } from '../../testing/builders'
import { EXPORT_EVENT, EXPORT_HOST, ExportScene } from '../../testing/exportScene'
import { makeInvalidateAlbumExport, type InvalidateExport } from './invalidateAlbumExport'
import { makeRecoverAlbumExports } from './recoverAlbumExports'
import { makeSweepAlbumExports, TEMPORARY_FILE_MAX_AGE_MS } from './sweepAlbumExports'

/**
 * What keeps the archive from outliving what it holds (spec 22, sections 7 and 9): the invalidation
 * every removing path calls, the sweep that collects what expired or lost its owner, and the
 * recovery after a crash.
 */

const OTHER = asEventId('event-2')
let scene: ExportScene

const sealSeal = (expiresAt: Date, bytes = 6): ExportSeal => ({
  entries: 3,
  skipped: 0,
  bytes,
  sha256: 'd'.repeat(64),
  expiresAt,
})

/** A sealed archive with its file. */
const seal = async (eventId = EXPORT_EVENT, expiresAt = atPlus(7 * 86_400_000)): Promise<void> => {
  await scene.exports.request(requestExport(eventId, EXPORT_HOST, atPlus(0)))
  await scene.exports.claimNext(atPlus(1))
  await scene.exports.finish(eventId, { kind: 'sealed', seal: sealSeal(expiresAt) }, atPlus(2))
  scene.exportFiles.seed(eventId, new Uint8Array(6))
}

beforeEach(() => {
  scene = new ExportScene()
})

describe('invalidateAlbumExport', () => {
  let invalidate: InvalidateExport
  beforeEach(() => {
    invalidate = makeInvalidateAlbumExport({
      exports: scene.exports,
      exportFiles: scene.exportFiles,
      bus: scene.bus,
      clock: scene.clock,
      logger: scene.logger,
    })
  })

  it('turns a sealed archive stale and deletes its file at once, not at the next sweep', async () => {
    await seal()

    await invalidate(EXPORT_EVENT, 'photoRemoved')

    expect(await scene.exports.find(EXPORT_EVENT)).toMatchObject({
      status: 'stale',
      staleReason: 'photoRemoved',
      invalidatedAt: scene.clock.now(),
    })
    expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(false)
    expect(scene.bus.published).toEqual([{ type: 'export.changed', eventId: EXPORT_EVENT }])
  })

  it('does nothing for an event that never asked for an archive', async () => {
    await invalidate(EXPORT_EVENT, 'photoRemoved')

    expect(await scene.exports.find(EXPORT_EVENT)).toBeNull()
    expect(scene.bus.published).toEqual([])
  })

  it.each(['queued', 'running'] as const)(
    'only records the instant for an archive that is %s: the build rules when its write ends',
    async (status) => {
      await scene.exports.request(requestExport(EXPORT_EVENT, EXPORT_HOST, atPlus(0)))
      if (status === 'running') await scene.exports.claimNext(atPlus(1))

      await invalidate(EXPORT_EVENT, 'guestErased')

      expect(await scene.exports.find(EXPORT_EVENT)).toMatchObject({
        status,
        staleReason: 'guestErased',
        invalidatedAt: scene.clock.now(),
      })
      expect(scene.bus.published).toEqual([])
    },
  )

  it('is idempotent, and retries the file deletion of an archive already stale', async () => {
    await seal()
    await invalidate(EXPORT_EVENT, 'photoRemoved')
    scene.exportFiles.seed(EXPORT_EVENT, new Uint8Array(6))
    scene.bus.published.length = 0

    await invalidate(EXPORT_EVENT, 'guestErased')

    expect((await scene.exports.find(EXPORT_EVENT))?.staleReason).toBe('photoRemoved')
    expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(false)
    expect(scene.bus.published).toEqual([])
  })

  it('never throws: the removal it was called for must not fail because a ZIP could not be tidied', async () => {
    await seal()
    scene.exportFiles.delete = async () => {
      throw new Error('EBUSY')
    }

    await expect(invalidate(EXPORT_EVENT, 'photoRemoved')).resolves.toBeUndefined()

    // The row says stale, so the file is not served though it is still there.
    expect((await scene.exports.find(EXPORT_EVENT))?.status).toBe('stale')
    expect(scene.logger.lines.some((line) => line.level === 'warn')).toBe(true)
  })

  it('never throws when the repository fails either', async () => {
    scene.exports.find = async () => {
      throw new Error('the database went away')
    }

    await expect(invalidate(EXPORT_EVENT, 'photoRemoved')).resolves.toBeUndefined()
  })
})

describe('recoverAlbumExports', () => {
  it('puts an archive a dead process left running back in the queue, and says so', async () => {
    await scene.exports.request(requestExport(EXPORT_EVENT, EXPORT_HOST, atPlus(0)))
    await scene.exports.claimNext(atPlus(1))
    const recover = makeRecoverAlbumExports({ exports: scene.exports, logger: scene.logger })

    expect(await recover()).toEqual({ requeued: 1 })

    expect((await scene.exports.find(EXPORT_EVENT))?.status).toBe('queued')
    expect(scene.logger.lines.some((line) => line.level === 'warn')).toBe(true)
  })

  it('says nothing when there was nothing to recover', async () => {
    const recover = makeRecoverAlbumExports({ exports: scene.exports, logger: scene.logger })

    expect(await recover()).toEqual({ requeued: 0 })
    expect(scene.logger.lines).toEqual([])
  })
})

describe('sweepAlbumExports', () => {
  const sweep = () =>
    makeSweepAlbumExports({
      exports: scene.exports,
      exportFiles: scene.exportFiles,
      bus: scene.bus,
      clock: scene.clock,
      logger: scene.logger,
    })()

  it('removes an archive whose expiry has passed, the file and the row, at the instant and not after', async () => {
    await seal(EXPORT_EVENT, atPlus(10_000))
    scene.clock.advance(10_000 - 60 * 60_000 - 1)
    expect(await sweep()).toMatchObject({ expired: 0 })

    scene.clock.advance(1)
    expect(await sweep()).toMatchObject({ expired: 1 })

    expect(await scene.exports.find(EXPORT_EVENT)).toBeNull()
    expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(false)
    expect(scene.bus.published).toEqual([{ type: 'export.changed', eventId: EXPORT_EVENT }])
  })

  it('leaves an archive that has not expired alone', async () => {
    await seal()

    expect(await sweep()).toEqual({ expired: 0, missing: 0, orphans: 0, temporaries: 0 })

    expect((await scene.exports.find(EXPORT_EVENT))?.status).toBe('sealed')
    expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(true)
    expect(scene.logger.lines).toEqual([])
  })

  it('turns a sealed row whose file is gone stale, so the host is told to make it again', async () => {
    await seal()
    await scene.exportFiles.delete(EXPORT_EVENT)

    expect(await sweep()).toMatchObject({ missing: 1 })

    expect(await scene.exports.find(EXPORT_EVENT)).toMatchObject({
      status: 'stale',
      staleReason: 'fileMissing',
    })
  })

  it('deletes a file no archive owns: a crash, a failed delete, an album that was purged', async () => {
    scene.exportFiles.seed(OTHER, new Uint8Array(3))

    expect(await sweep()).toMatchObject({ orphans: 1 })

    expect(scene.exportFiles.has(OTHER)).toBe(false)
  })

  it('does not delete the file of an archive that is sealed, or still being made', async () => {
    await seal(EXPORT_EVENT)
    await scene.exports.request(requestExport(OTHER, EXPORT_HOST, atPlus(0)))
    scene.exportFiles.seed(OTHER, new Uint8Array(3))

    expect(await sweep()).toMatchObject({ orphans: 0 })

    expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(true)
    expect(scene.exportFiles.has(OTHER)).toBe(true)
  })

  it('deletes the file of a stale archive that a failed delete left behind', async () => {
    await seal()
    // The invalidation ran, the row is stale, and the disk refused to let the file go.
    await scene.exports.invalidate(EXPORT_EVENT, 'photoRemoved', atPlus(5))

    expect(await sweep()).toMatchObject({ orphans: 1 })

    expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(false)
  })

  it('deletes a temporary file older than a quarter of an hour, and spares a younger one', async () => {
    const now = scene.clock.now().getTime()
    scene.exportFiles.seedTemporary('old.1.tmp', 10, new Date(now - TEMPORARY_FILE_MAX_AGE_MS - 1))
    scene.exportFiles.seedTemporary('edge.2.tmp', 10, new Date(now - TEMPORARY_FILE_MAX_AGE_MS))
    scene.exportFiles.seedTemporary('young.3.tmp', 10, new Date(now - 60_000))

    expect(await sweep()).toMatchObject({ temporaries: 1 })

    expect((await scene.exportFiles.listTemporary()).map((file) => file.name).sort()).toEqual([
      'edge.2.tmp',
      'young.3.tmp',
    ])
  })

  it('reports what it swept in one line', async () => {
    scene.exportFiles.seed(OTHER, new Uint8Array(3))

    await sweep()

    expect(scene.logger.lines).toEqual([
      {
        level: 'info',
        message: 'album archives swept',
        context: { expired: 0, missing: 0, orphans: 1, temporaries: 0 },
      },
    ])
  })
})
