import { beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '../../../domain/clients/client'
import { requestExport } from '../../../domain/exports/albumExport'
import { readZipEnd } from '../../../domain/exports/zipEndRecord'
import { DomainError } from '../../../domain/shared/errors'
import type { ArchiveWriter } from '../../ports/archiveWriter'
import { aClient, aClipJob, aGuestbookEntry, anEvent, atPlus } from '../../testing/builders'
import {
  DEFAULT_EXPORT_POLICY,
  EXPORT_EVENT,
  EXPORT_HOST,
  ExportScene,
  type ExportScenePolicy,
} from '../../testing/exportScene'
import { FakeArchiveWriter } from '../../testing/fakeArchiveWriter'
import {
  makeBuildNextAlbumExport,
  type BuildNextAlbumExport,
  type BuildNextAlbumExportOutcome,
} from './buildNextAlbumExport'

/**
 * One pass of the archive queue (spec 22, section 6). "Verified" is four checks of the server's, and
 * each one has a test here that fails when the check is removed: the room, a file against its
 * digest, the count of rows, and the finished file read back from the disk.
 */

let scene: ExportScene
let build: BuildNextAlbumExport

const wire = (
  options: {
    readonly policy?: ExportScenePolicy
    readonly archive?: ArchiveWriter
    readonly event?: ReturnType<typeof anEvent>
    readonly clients?: readonly Client[]
  } = {},
): void => {
  const policy = options.policy ?? DEFAULT_EXPORT_POLICY
  scene = new ExportScene(policy, options.event, options.clients)
  build = makeBuildNextAlbumExport({
    events: scene.events,
    clients: scene.clients,
    guests: scene.guests,
    guestbook: scene.guestbook,
    photos: scene.photos,
    media: scene.media,
    archive: options.archive ?? scene.archive,
    streamHasher: scene.streamHasher,
    exports: scene.exports,
    exportFiles: scene.exportFiles,
    clips: scene.clips,
    bus: scene.bus,
    clock: scene.clock,
    logger: scene.logger,
    policy,
    freeDiskBytes: scene.freeDiskBytes,
  })
}

/** The host asks, the row is queued. */
const ask = async (): Promise<void> => {
  await scene.exports.request(requestExport(EXPORT_EVENT, EXPORT_HOST, scene.clock.now()))
}

const run = async (signal?: AbortSignal): Promise<BuildNextAlbumExportOutcome> => build(signal)

const digestOfStoredFile = (): string => {
  const bytes = scene.exportFiles.bytesOf(EXPORT_EVENT)
  if (bytes === null) throw new Error('no archive file')
  const hash = scene.streamHasher.start()
  hash.update(bytes)
  return hash.digestHex()
}

const textOfStoredFile = (): string =>
  new TextDecoder().decode(scene.exportFiles.bytesOf(EXPORT_EVENT) ?? new Uint8Array())

beforeEach(() => wire())

describe('buildNextAlbumExport', () => {
  it('does nothing when no archive was asked for', async () => {
    expect(await run()).toEqual({ kind: 'idle' })
  })

  describe('an archive that goes well', () => {
    beforeEach(async () => {
      await scene.photo({ id: 'p1', createdAt: atPlus(1_000) })
      await scene.photo({ id: 'p2', createdAt: atPlus(2_000), status: 'hidden' })
      await scene.clip({ id: 'c1', createdAt: atPlus(3_000) })
      await scene.photo({ id: 'rejected', status: 'rejected' })
      scene.guestbook.seed(aGuestbookEntry({ id: 'm1', eventId: 'event-1', moderation: 'auto' }))
      await ask()
    })

    it('seals it with what was written, its size and the digest of the whole file', async () => {
      const outcome = await run()

      const stored = scene.exportFiles.bytesOf(EXPORT_EVENT)
      expect(outcome).toEqual({
        kind: 'sealed',
        eventId: EXPORT_EVENT,
        // Two photographs (published and hidden), a clip, the guestbook: not the rejected one,
        // not the manifest.
        entries: 4,
        skipped: 0,
        bytes: stored?.byteLength,
      })
      expect(await scene.exports.find(EXPORT_EVENT)).toMatchObject({
        status: 'sealed',
        entries: 4,
        skipped: 0,
        bytes: stored?.byteLength,
        sha256: digestOfStoredFile(),
        sealedAt: scene.clock.now(),
        servedAt: null,
      })
    })

    it('closes the archive with the manifest and writes it from the same loop as the streamed ZIP', async () => {
      await run()

      expect(scene.archive.names.at(-1)).toBe('camille-et-sacha/MANIFEST.sha256')
      expect(scene.archive.names.at(-2)).toBe('camille-et-sacha/guestbook.txt')
      expect(textOfStoredFile()).toContain('# missing: 0')
    })

    it('ends the file with a record that announces its files and the manifest', async () => {
      await run()

      const stored = scene.exportFiles.bytesOf(EXPORT_EVENT) ?? new Uint8Array()
      expect(readZipEnd(stored)).toEqual({ entries: 5 })
    })

    it('lets the archive live its ttl when nothing comes first', async () => {
      await run()

      expect((await scene.exports.find(EXPORT_EVENT))?.expiresAt).toEqual(
        new Date(scene.clock.now().getTime() + 7 * 86_400_000),
      )
    })

    it('announces the start and the end, and logs the seal', async () => {
      await run()

      expect(scene.statusesOf()).toEqual(['export.changed', 'export.changed'])
      expect(scene.logger.lines.some((line) => line.message === 'album archive sealed')).toBe(true)
    })

    it('leaves no temporary file and no stale row behind', async () => {
      await run()

      expect(await scene.exportFiles.listTemporary()).toEqual([])
      expect(await scene.exports.listActiveEventIds()).toEqual([])
    })

    it('does not hold against the archive a removal that was recorded before it started', async () => {
      await scene.exports.invalidate(EXPORT_EVENT, 'guestErased', scene.clock.now())
      scene.clock.advance(1)

      // The album is read when the write starts: what was removed is not in it.
      expect(await run()).toMatchObject({ kind: 'sealed' })
    })
  })

  describe('its expiry', () => {
    it('is the album’s deadline when it comes before the ttl', async () => {
      wire({
        event: anEvent({
          id: 'event-1',
          slug: 'camille-et-sacha',
          status: 'closed',
          settings: { retentionDays: 2 },
        }),
      })
      await ask()

      await run()

      // Closed at AT, retention of 2 days: the deadline is before the 7 days of the ttl.
      expect((await scene.exports.find(EXPORT_EVENT))?.expiresAt).toEqual(
        new Date(atPlus(0).getTime() + 2 * 86_400_000),
      )
    })
  })

  describe('its expiry, with the event’s client in the picture', () => {
    it('is the client’s retention ceiling when that comes before the ttl', async () => {
      wire({
        event: anEvent({
          id: 'event-1',
          slug: 'camille-et-sacha',
          status: 'closed',
          clientId: 'client-1',
          settings: { retentionDays: 365 },
        }),
        clients: [aClient({ id: 'client-1', ceilings: { maxRetentionDays: 2 } })],
      })
      await ask()

      await run()

      expect((await scene.exports.find(EXPORT_EVENT))?.expiresAt).toEqual(
        new Date(atPlus(0).getTime() + 2 * 86_400_000),
      )
    })
  })

  describe('check 2: each file against its digest', () => {
    it('stops at a clip that is not what its name says, seals nothing, and says so', async () => {
      await scene.photo({ id: 'p1' })
      await scene.clip({ id: 'c1' }, new Uint8Array([9, 9, 9, 9]), 'f'.repeat(64))
      await ask()

      const outcome = await run()

      expect(outcome).toEqual({
        kind: 'failed',
        eventId: EXPORT_EVENT,
        code: 'corrupt',
      })
      expect(await scene.exports.find(EXPORT_EVENT)).toMatchObject({
        status: 'failed',
        failure: 'corrupt',
        sha256: null,
      })
      expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(false)
      expect(
        scene.logger.lines.some(
          (line) => line.level === 'error' && /not what its digest says/.test(line.message),
        ),
      ).toBe(true)
    })

    it('does not condemn a healthy photograph: its original is not named by the digest of its display (CLAUDE.md trap 12)', async () => {
      await scene.photo({ id: 'p1' }, new Uint8Array([4, 5, 6]))
      await ask()

      expect(await run()).toMatchObject({ kind: 'sealed', entries: 1 })
    })
  })

  describe('a file that is not on the disk', () => {
    it('is skipped and counted: the archive is sealed, verified, and not complete', async () => {
      await scene.photo({ id: 'p1' })
      scene.lostPhoto({ id: 'p2' })
      scene.lostPhoto({ id: 'p3' })
      await ask()

      const outcome = await run()

      expect(outcome).toMatchObject({ kind: 'sealed', entries: 1, skipped: 2 })
      expect(await scene.exports.find(EXPORT_EVENT)).toMatchObject({ entries: 1, skipped: 2 })
      expect(textOfStoredFile()).toContain('# missing: 2')
    })
  })

  describe('check 3: the count of rows', () => {
    it('makes the archive stale, not sealed, when a photograph arrived while it was written', async () => {
      await scene.photo({ id: 'p1' })
      await scene.photo({ id: 'p2' })
      await ask()
      scene.exportFiles.duringWrite = async () => {
        await scene.photo({ id: 'late', createdAt: atPlus(9_000_000) })
      }

      const outcome = await run()

      expect(outcome).toEqual({ kind: 'stale', eventId: EXPORT_EVENT })
      expect(await scene.exports.find(EXPORT_EVENT)).toMatchObject({
        status: 'stale',
        staleReason: 'albumChanged',
        sha256: null,
      })
      expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(false)
    })

    it('makes it stale when a photograph arrives after the page was read: the rows at the end are not the rows at the start', async () => {
      await scene.photo({ id: 'p1' })
      await scene.photo({ id: 'p2' })
      await ask()
      const list = scene.photos.list.bind(scene.photos)
      let pages = 0
      scene.photos.list = async (...args) => {
        const page = await list(...args)
        pages += 1
        // After the only page was read, so the files written are exactly the rows counted at the start.
        if (pages === 1) await scene.photo({ id: 'late', createdAt: atPlus(9_000_000) })
        return page
      }

      expect(await run()).toEqual({ kind: 'stale', eventId: EXPORT_EVENT })
    })

    it('makes it stale when the rows it listed are not the rows the album has at the end', async () => {
      // 201 photographs: two pages. While the first is written, the oldest row (on the second page)
      // leaves and a newer one arrives, so the count is the same at the end and the pages disagree.
      for (let n = 0; n < 201; n += 1) {
        await scene.photo({
          id: `p${String(n).padStart(3, '0')}`,
          createdAt: atPlus(n * 1_000),
          byteSize: 10,
        })
      }
      await ask()
      const list = scene.photos.list.bind(scene.photos)
      let pages = 0
      scene.photos.list = async (...args) => {
        const page = await list(...args)
        pages += 1
        if (pages === 1) {
          await scene.photos.delete(EXPORT_EVENT, asPhotoId('p000'))
          await scene.photo({ id: 'newer', createdAt: atPlus(999_000_000), byteSize: 10 })
        }
        return page
      }

      const outcome = await run()

      expect(outcome).toEqual({ kind: 'stale', eventId: EXPORT_EVENT })
    })

    it('seals an album that did not move', async () => {
      for (let n = 0; n < 201; n += 1) {
        await scene.photo({
          id: `p${String(n).padStart(3, '0')}`,
          createdAt: atPlus(n * 1_000),
          byteSize: 10,
        })
      }
      await ask()

      expect(await run()).toMatchObject({ kind: 'sealed', entries: 201 })
    })
  })

  describe('a fact that voided the archive while it was written', () => {
    it('wins over the file just produced: stale, with the reason, and the file is deleted', async () => {
      await scene.photo({ id: 'p1' })
      await ask()
      scene.exportFiles.duringWrite = async () => {
        await scene.exports.invalidate(EXPORT_EVENT, 'guestErased', scene.clock.now())
      }

      const outcome = await run()

      expect(outcome).toEqual({ kind: 'stale', eventId: EXPORT_EVENT })
      expect(await scene.exports.find(EXPORT_EVENT)).toMatchObject({
        status: 'stale',
        staleReason: 'guestErased',
      })
      expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(false)
    })
  })

  describe('check 4: the finished file read again from the disk', () => {
    it('refuses a file the disk cut short, though the write reported every byte', async () => {
      await scene.photo({ id: 'p1' })
      await ask()
      scene.exportFiles.alterNextWrite = (bytes) => bytes.slice(0, bytes.byteLength - 7)

      const outcome = await run()

      expect(outcome).toEqual({ kind: 'failed', eventId: EXPORT_EVENT, code: 'unverified' })
      expect(await scene.exports.find(EXPORT_EVENT)).toMatchObject({
        status: 'failed',
        failure: 'unverified',
      })
      expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(false)
    })

    it('refuses a file of the right size whose bytes are not the ones that were written', async () => {
      await scene.photo({ id: 'p1' })
      await ask()
      scene.exportFiles.alterNextWrite = (bytes) => {
        const copy = bytes.slice()
        copy[4] = (copy[4] ?? 0) ^ 0xff
        return copy
      }

      const outcome = await run()

      expect(outcome).toMatchObject({ kind: 'failed', code: 'unverified' })
      expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(false)
    })

    it('refuses a file whose size on the disk is not the size that was written, though its bytes read back right', async () => {
      await scene.photo({ id: 'p1' })
      await ask()
      const stat = scene.exportFiles.stat.bind(scene.exportFiles)
      scene.exportFiles.stat = async (eventId) => {
        const found = await stat(eventId)
        return found === null ? null : { size: found.size + 1 }
      }

      expect(await run()).toMatchObject({ kind: 'failed', code: 'unverified' })
    })

    it('refuses a file that vanished between the write and the reading', async () => {
      await scene.photo({ id: 'p1' })
      await ask()
      scene.exportFiles.duringWrite = null
      const original = scene.exportFiles.stat.bind(scene.exportFiles)
      scene.exportFiles.stat = async () => {
        await scene.exportFiles.delete(EXPORT_EVENT)
        return original(EXPORT_EVENT)
      }

      expect(await run()).toMatchObject({ kind: 'failed', code: 'unverified' })
    })

    it('refuses a file whose end record is missing: a ZIP with no central directory', async () => {
      wire({ archive: new FakeArchiveWriter({ emits: 'content' }) })
      await scene.photo({ id: 'p1' })
      await ask()

      expect(await run()).toMatchObject({ kind: 'failed', code: 'unverified' })
    })

    it('refuses a file whose end record announces another number of files', async () => {
      const lying: ArchiveWriter = {
        stream: (entries) =>
          (async function* () {
            for await (const entry of entries) for await (const chunk of entry.bytes) void chunk
            const end = new Uint8Array(22)
            const view = new DataView(end.buffer)
            view.setUint32(0, 0x06054b50, true)
            view.setUint16(8, 99, true)
            view.setUint16(10, 99, true)
            yield end
          })(),
      }
      wire({ archive: lying })
      await scene.photo({ id: 'p1' })
      await ask()

      expect(await run()).toMatchObject({ kind: 'failed', code: 'unverified' })
    })

    it('accepts the file whose end record announces its files and the manifest', async () => {
      await scene.photo({ id: 'p1' })
      await scene.photo({ id: 'p2' })
      await ask()

      expect(await run()).toMatchObject({ kind: 'sealed', entries: 2 })
    })
  })

  describe('check 1: the room', () => {
    beforeEach(async () => {
      for (const id of ['p1', 'p2', 'p3']) await scene.photo({ id, byteSize: 1_000 })
      await ask()
    })
    const ESTIMATE = 3_000 + 3 * 100

    it('refuses before writing a byte when the disk cannot take it and the minimum', async () => {
      scene.freeDisk = ESTIMATE + DEFAULT_EXPORT_POLICY.minFreeDiskBytes - 1

      const outcome = await run()

      expect(outcome).toEqual({ kind: 'failed', eventId: EXPORT_EVENT, code: 'noRoom' })
      expect(scene.archive.entries).toEqual([])
      expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(false)
    })

    it('refuses a disk that cannot be read', async () => {
      scene.freeDisk = null

      expect(await run()).toMatchObject({ kind: 'failed', code: 'noRoom' })
    })

    it('takes the archive when exactly that much is free', async () => {
      scene.freeDisk = ESTIMATE + DEFAULT_EXPORT_POLICY.minFreeDiskBytes

      expect(await run()).toMatchObject({ kind: 'sealed' })
    })

    it('refuses an archive over EXPORT_MAX_BYTES before writing', async () => {
      wire({ policy: { ...DEFAULT_EXPORT_POLICY, maxBytes: ESTIMATE - 1 } })
      for (const id of ['p1', 'p2', 'p3']) await scene.photo({ id, byteSize: 1_000 })
      await ask()

      expect(await run()).toMatchObject({ kind: 'failed', code: 'tooLarge' })
      expect(scene.archive.entries).toEqual([])
    })

    it('fails tooLarge when the real archive outgrows the ceiling the estimate let through', async () => {
      wire({ policy: { ...DEFAULT_EXPORT_POLICY, maxBytes: 40 } })
      await scene.photo({ id: 'p1', byteSize: 1 })
      await ask()

      expect(await run()).toMatchObject({ kind: 'failed', code: 'tooLarge' })
      expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(false)
    })

    it('refuses an archive that would take the box past EXPORT_MAX_TOTAL_BYTES', async () => {
      wire({ policy: { ...DEFAULT_EXPORT_POLICY, maxTotalBytes: ESTIMATE + 4_999 } })
      for (const id of ['p1', 'p2', 'p3']) await scene.photo({ id, byteSize: 1_000 })
      // Another archive in the making on the box: a temporary file, which weighs what it has written.
      scene.exportFiles.seedTemporary('event-other.1.tmp', 5_000, scene.clock.now())
      await ask()

      expect(await run()).toMatchObject({ kind: 'failed', code: 'noRoom' })
    })

    it('reads the disk again every page of 200 entries and stops when the minimum is gone', async () => {
      wire()
      for (let n = 0; n < 205; n += 1) {
        await scene.photo({
          id: `p${String(n).padStart(3, '0')}`,
          createdAt: atPlus(n * 1_000),
          byteSize: 10,
        })
      }
      await ask()
      // Room at the start, then a wedding fills the disk with videos while the archive is written.
      scene.exportFiles.duringWrite = async () => {
        scene.freeDisk = DEFAULT_EXPORT_POLICY.minFreeDiskBytes - 1
      }

      const outcome = await run()

      expect(outcome).toEqual({ kind: 'failed', eventId: EXPORT_EVENT, code: 'noRoom' })
      expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(false)
      expect(await scene.exportFiles.listTemporary()).toEqual([])
    })

    it('keeps writing while the minimum holds at every page', async () => {
      wire()
      for (let n = 0; n < 205; n += 1) {
        await scene.photo({
          id: `p${String(n).padStart(3, '0')}`,
          createdAt: atPlus(n * 1_000),
          byteSize: 10,
        })
      }
      await ask()
      scene.exportFiles.duringWrite = async () => {
        scene.freeDisk = DEFAULT_EXPORT_POLICY.minFreeDiskBytes
      }

      expect(await run()).toMatchObject({ kind: 'sealed', entries: 205 })
    })

    it('treats a disk that became unreadable while writing as no room', async () => {
      wire()
      for (let n = 0; n < 205; n += 1) {
        await scene.photo({
          id: `p${String(n).padStart(3, '0')}`,
          createdAt: atPlus(n * 1_000),
          byteSize: 10,
        })
      }
      await ask()
      scene.exportFiles.duringWrite = async () => {
        scene.freeDisk = null
      }

      expect(await run()).toMatchObject({ kind: 'failed', code: 'noRoom' })
    })
  })

  describe('whether anybody may still be given an archive of the event', () => {
    beforeEach(async () => {
      await scene.photo({ id: 'p1' })
      await ask()
    })

    it('gives up as unavailable when the operator took the event down since the request', async () => {
      await scene.events.setTakenDown(EXPORT_EVENT, atPlus(0))

      const outcome = await run()

      expect(outcome).toEqual({ kind: 'failed', eventId: EXPORT_EVENT, code: 'unavailable' })
      expect(scene.archive.entries).toEqual([])
    })

    it('gives up as unavailable, and deletes the file, when it was taken down while it was written', async () => {
      scene.exportFiles.duringWrite = async () => {
        await scene.events.setTakenDown(EXPORT_EVENT, atPlus(0))
      }

      const outcome = await run()

      expect(outcome).toMatchObject({ kind: 'failed', code: 'unavailable' })
      expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(false)
    })

    it('abandons an album that was purged while it was written: no row to receive a verdict, no file', async () => {
      scene.exportFiles.duringWrite = async () => {
        await scene.exports.delete(EXPORT_EVENT)
      }

      const outcome = await run()

      expect(outcome).toEqual({ kind: 'superseded', eventId: EXPORT_EVENT })
      expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(false)
    })

    it('does not seal a row the host asked for again meanwhile', async () => {
      scene.exportFiles.duringWrite = async () => {
        await scene.exports.request(requestExport(EXPORT_EVENT, EXPORT_HOST, atPlus(7_000)))
      }

      const outcome = await run()

      expect(outcome).toEqual({ kind: 'superseded', eventId: EXPORT_EVENT })
      expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(false)
      expect((await scene.exports.find(EXPORT_EVENT))?.status).toBe('queued')
    })

    it('answers superseded, not failed, when the row left while it was giving up', async () => {
      await scene.exports.delete(EXPORT_EVENT)
      await scene.exports.request(requestExport(EXPORT_EVENT, EXPORT_HOST, atPlus(1)))
      scene.freeDisk = 0
      const before = scene.exports.finish.bind(scene.exports)
      scene.exports.finish = async (...args) => {
        await scene.exports.delete(EXPORT_EVENT)
        return before(...args)
      }

      expect(await run()).toEqual({ kind: 'superseded', eventId: EXPORT_EVENT })
    })
  })

  describe('behind the video transcodes', () => {
    beforeEach(async () => {
      await scene.photo({ id: 'p1' })
      await ask()
      scene.clips.seed(aClipJob({ id: 'job-1', eventId: 'event-1', status: 'running' }))
    })

    it('waits while a transcode runs and the request is recent, leaving it queued', async () => {
      const outcome = await run()

      expect(outcome).toEqual({ kind: 'waiting' })
      expect((await scene.exports.find(EXPORT_EVENT))?.status).toBe('queued')
      expect(scene.bus.published).toEqual([])
    })

    it('starts anyway once it has waited as long as the box says', async () => {
      scene.clock.advance(DEFAULT_EXPORT_POLICY.maxWaitMs)

      expect(await run()).toMatchObject({ kind: 'sealed' })
    })

    it('starts at once when no transcode runs', async () => {
      await scene.clips.deleteForAuthor(EXPORT_EVENT, asGuestId('guest-1'))
      scene.clips.seed()
      // The running job above belongs to guest-1 of this event: removing it empties the queue.
      expect(await run()).toMatchObject({ kind: 'sealed' })
    })
  })

  describe('a failure nobody planned for', () => {
    beforeEach(async () => {
      await scene.photo({ id: 'p1' })
      await ask()
    })

    it('gives the archive up as unexpected instead of leaving it running for ever', async () => {
      scene.photos.countsByStatus = async () => {
        throw new Error('the database went away')
      }

      const outcome = await run()

      expect(outcome).toEqual({ kind: 'failed', eventId: EXPORT_EVENT, code: 'unexpected' })
      expect((await scene.exports.find(EXPORT_EVENT))?.status).toBe('failed')
      expect(scene.logger.lines.some((line) => line.level === 'error')).toBe(true)
    })

    it('gives it up as unexpected when the write itself fails, and keeps no file', async () => {
      scene.exportFiles.failNextWriteWith = new Error('EIO')

      const outcome = await run()

      expect(outcome).toMatchObject({ kind: 'failed', code: 'unexpected' })
      expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(false)
    })

    it('keeps a failed archive’s old file out of the way: the file goes with the failure', async () => {
      scene.exportFiles.seed(EXPORT_EVENT, new Uint8Array([1, 2, 3]))
      scene.freeDisk = 0

      await run()

      expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(false)
    })

    it('still fails the archive when the file cannot be deleted, and says so', async () => {
      scene.freeDisk = 0
      scene.exportFiles.delete = async () => {
        throw new Error('EBUSY')
      }

      const outcome = await run()

      expect(outcome).toMatchObject({ kind: 'failed', code: 'noRoom' })
      expect(scene.logger.lines.some((line) => line.message.includes('could not delete'))).toBe(
        true,
      )
    })

    it('does not log an error for a refusal it chose: a domain failure is not an accident', async () => {
      scene.freeDisk = 0

      await run()

      expect(scene.logger.lines.filter((line) => line.level === 'error')).toEqual([])
    })
  })

  describe('the corners of the build', () => {
    beforeEach(async () => {
      await scene.photo({ id: 'p1' })
      await ask()
    })

    it('reports a refusal it does not know as unexpected, without logging an accident', async () => {
      scene.exportFiles.failNextWriteWith = DomainError.conflict('export.mystery')

      const outcome = await run()

      expect(outcome).toEqual({ kind: 'failed', eventId: EXPORT_EVENT, code: 'unexpected' })
      expect(scene.logger.lines.filter((line) => line.level === 'error')).toEqual([])
    })

    it('reports a failure after the claim that is a refusal of its own by its own code', async () => {
      scene.photos.countsByStatus = async () => {
        throw DomainError.conflict('export.noRoom')
      }

      expect(await run()).toEqual({ kind: 'failed', eventId: EXPORT_EVENT, code: 'noRoom' })
      expect(scene.logger.lines.filter((line) => line.level === 'error')).toEqual([])
    })

    it('gives up as unavailable when the album was purged between the request and the claim', async () => {
      await scene.events.deleteUnlessHeld(EXPORT_EVENT)

      expect(await run()).toEqual({ kind: 'failed', eventId: EXPORT_EVENT, code: 'unavailable' })
    })

    it('answers idle when another claim took the request between the look and the claim', async () => {
      scene.exports.claimNext = async () => null

      expect(await run()).toEqual({ kind: 'idle' })
    })

    it.each([
      ['the whole file', 1],
      ['the end of the file', 2],
    ])('refuses a file that cannot be opened to read back %s', async (_name, call) => {
      const openRead = scene.exportFiles.openRead.bind(scene.exportFiles)
      let calls = 0
      scene.exportFiles.openRead = async (...args) => {
        calls += 1
        return calls === call ? null : openRead(...args)
      }

      expect(await run()).toMatchObject({ kind: 'failed', code: 'unverified' })
    })

    it('answers superseded, not stale, when the row left and the album had changed', async () => {
      scene.exportFiles.duringWrite = async () => {
        await scene.exports.delete(EXPORT_EVENT)
        await scene.photo({ id: 'late', createdAt: atPlus(9_000_000) })
      }

      expect(await run()).toEqual({ kind: 'superseded', eventId: EXPORT_EVENT })
    })
  })

  describe('a shutdown', () => {
    beforeEach(async () => {
      await scene.photo({ id: 'p1' })
      await scene.photo({ id: 'p2' })
      await ask()
    })

    it('stops the write between two entries, leaves the row running for the boot to re-queue, and keeps no file', async () => {
      const controller = new AbortController()
      scene.exportFiles.duringWrite = async () => controller.abort()

      const outcome = await run(controller.signal)

      expect(outcome).toEqual({ kind: 'aborted', eventId: EXPORT_EVENT })
      expect((await scene.exports.find(EXPORT_EVENT))?.status).toBe('running')
      expect(scene.exportFiles.has(EXPORT_EVENT)).toBe(false)
      expect(await scene.exportFiles.listTemporary()).toEqual([])
      expect(await scene.exports.recoverRunning()).toBe(1)
    })

    it('answers aborted too when it was an unexpected failure that the shutdown caused', async () => {
      const controller = new AbortController()
      scene.photos.countsByStatus = async () => {
        controller.abort()
        throw new Error('closed under me')
      }

      expect(await run(controller.signal)).toEqual({ kind: 'aborted', eventId: EXPORT_EVENT })
      expect((await scene.exports.find(EXPORT_EVENT))?.status).toBe('running')
    })
  })
})

const asPhotoId = (value: string) => value as Parameters<typeof scene.photos.delete>[1]
const asGuestId = (value: string) => value as Parameters<typeof scene.clips.deleteForAuthor>[1]
