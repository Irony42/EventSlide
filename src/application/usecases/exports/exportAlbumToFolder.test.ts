import { beforeEach, describe, expect, it } from 'vitest'
import { readZipEnd } from '../../../domain/exports/zipEndRecord'
import { aGuestbookEntry, anEvent, aPhoto, atPlus } from '../../testing/builders'
import { DEFAULT_EXPORT_POLICY, ExportScene } from '../../testing/exportScene'
import { FakeExportFolderStore } from '../../testing/fakeExportFolderStore'
import { makeExportAlbumToFolder, type ExportAlbumToFolder } from './exportAlbumToFolder'

/**
 * The operator's copy of an album (spec 22, section 8): the same four checks as the host's archive,
 * a folder instead of a row, and no row at all. Each check has a test that fails when it is removed.
 */

const FOLDER = 'camille-et-sacha-2026-12-01'

let scene: ExportScene
let folders: FakeExportFolderStore
let exportToFolder: ExportAlbumToFolder

const wire = (event = anEvent({ id: 'event-1', slug: 'camille-et-sacha', status: 'closed' })) => {
  scene = new ExportScene(DEFAULT_EXPORT_POLICY, event)
  folders = new FakeExportFolderStore()
  exportToFolder = makeExportAlbumToFolder({
    photos: scene.photos,
    guestbook: scene.guestbook,
    guests: scene.guests,
    media: scene.media,
    archive: scene.archive,
    streamHasher: scene.streamHasher,
    folders,
    clock: scene.clock,
    logger: scene.logger,
    freeDiskBytes: scene.freeDiskBytes,
    minFreeDiskBytes: DEFAULT_EXPORT_POLICY.minFreeDiskBytes,
  })
}

const event = () => scene.events.findById(anEvent({ id: 'event-1' }).id)
const go = async () => {
  const found = await event()
  if (found === null) throw new Error('no event')
  return exportToFolder(found, FOLDER)
}

beforeEach(() => wire())

describe('exportAlbumToFolder', () => {
  describe('an album that goes well', () => {
    beforeEach(async () => {
      await scene.photo({ id: 'p1', createdAt: atPlus(1_000) })
      await scene.photo({ id: 'p2', createdAt: atPlus(2_000), status: 'hidden' })
      await scene.clip({ id: 'c1', createdAt: atPlus(3_000) })
      await scene.photo({ id: 'rejected', status: 'rejected' })
      scene.guestbook.seed(aGuestbookEntry({ id: 'm1', eventId: 'event-1', moderation: 'auto' }))
    })

    it('writes the archive and its manifest into the folder and reports what it holds', async () => {
      const outcome = await go()

      const stored = folders.bytesOf(FOLDER)
      expect(outcome).toEqual({
        kind: 'written',
        folder: FOLDER,
        entries: 4,
        skipped: 0,
        bytes: stored?.byteLength,
        sha256: expect.stringMatching(/^[0-9a-f]+$/) as unknown,
      })
      expect(readZipEnd(stored ?? new Uint8Array())).toEqual({ entries: 5 })
    })

    it('writes beside the zip the very manifest that closes the zip', async () => {
      await go()

      const manifest = folders.manifestOf(FOLDER) ?? ''
      expect(manifest).toContain('# missing: 0')
      expect(manifest.trim().split('\n')).toHaveLength(5)
      const inZip = new TextDecoder().decode(folders.bytesOf(FOLDER) ?? new Uint8Array())
      expect(inZip).toContain(manifest)
    })

    it('touches no row of the box: a copy for the operator is not an archive sent to the host', async () => {
      await go()

      expect(await scene.exports.find(anEvent({ id: 'event-1' }).id)).toBeNull()
      expect(scene.exportFiles.has(anEvent({ id: 'event-1' }).id)).toBe(false)
    })

    it('does not apply the box’s own size ceilings to a disk that is not the box’s', async () => {
      // 10 MB is the box's per-archive ceiling in the scene; the copy is far above the estimate.
      await scene.photo({ id: 'big', createdAt: atPlus(4_000) }, new Uint8Array(1_000))

      expect(await go()).toMatchObject({ kind: 'written' })
    })
  })

  it('refuses an evening that is not over, and writes nothing', async () => {
    wire(anEvent({ id: 'event-1', slug: 'camille-et-sacha', status: 'live' }))
    await scene.photo({ id: 'p1' })

    expect(await go()).toEqual({ kind: 'failed', folder: FOLDER, code: 'notClosed' })
    expect(folders.writes).toEqual([])
  })

  describe('check 1: the room', () => {
    it('refuses before writing a byte when the disk has no room', async () => {
      await scene.photo({ id: 'p1' })
      scene.freeDisk = 10

      expect(await go()).toEqual({ kind: 'failed', folder: FOLDER, code: 'noRoom' })
      expect(folders.writes).toEqual([])
    })

    it('refuses when the disk cannot be read', async () => {
      await scene.photo({ id: 'p1' })
      scene.freeDisk = null

      expect(await go()).toMatchObject({ kind: 'failed', code: 'noRoom' })
      expect(folders.writes).toEqual([])
    })

    it('abandons the write and deletes it when the room runs out meanwhile', async () => {
      for (let i = 0; i < 250; i += 1) await scene.photo({ id: `p${i}`, createdAt: atPlus(i) })
      let reads = 0
      scene.freeDisk = 1_000_000_000
      const real = scene.freeDiskBytes
      const probe = async (): Promise<number | null> => {
        reads += 1
        // The estimate's read is the first; the page read (every 200 entries) is the second.
        return reads >= 2 ? 0 : real()
      }
      exportToFolder = makeExportAlbumToFolder({
        photos: scene.photos,
        guestbook: scene.guestbook,
        guests: scene.guests,
        media: scene.media,
        archive: scene.archive,
        streamHasher: scene.streamHasher,
        folders,
        clock: scene.clock,
        logger: scene.logger,
        freeDiskBytes: probe,
        minFreeDiskBytes: DEFAULT_EXPORT_POLICY.minFreeDiskBytes,
      })

      expect(await go()).toEqual({ kind: 'failed', folder: FOLDER, code: 'noRoom' })
      expect(folders.folders()).toEqual([])
    })
  })

  describe('check 2: each file against its digest', () => {
    it('writes no copy of an album holding a clip that is not what its name says', async () => {
      await scene.photo({ id: 'p1' })
      await scene.clip({ id: 'c1' }, new Uint8Array([9, 9, 9, 9]), 'f'.repeat(64))

      expect(await go()).toEqual({ kind: 'failed', folder: FOLDER, code: 'corrupt' })
      expect(folders.folders()).toEqual([])
    })
  })

  describe('check 3: the count', () => {
    it('refuses a copy of an album that changed while it was written, and deletes it', async () => {
      await scene.photo({ id: 'p1' })
      await scene.photo({ id: 'p2' })
      const list = scene.photos.list.bind(scene.photos)
      let pages = 0
      scene.photos.list = async (...args) => {
        const page = await list(...args)
        pages += 1
        if (pages === 1) await scene.photo({ id: 'late', createdAt: atPlus(9_000_000) })
        return page
      }

      expect(await go()).toEqual({ kind: 'failed', folder: FOLDER, code: 'stale' })
      expect(folders.folders()).toEqual([])
    })

    it('says how many files were missing from the disk and still writes the copy', async () => {
      await scene.photo({ id: 'p1' })
      scene.photos.seed(aPhoto({ id: 'lost', eventId: 'event-1', status: 'published' }))

      const outcome = await go()

      expect(outcome).toMatchObject({ kind: 'written', skipped: 1 })
      expect(folders.manifestOf(FOLDER)).toContain('# missing: 1')
    })
  })

  describe('check 4: the finished file read again', () => {
    it('refuses and deletes a file the disk cut short, though the write reported every byte', async () => {
      await scene.photo({ id: 'p1' })
      folders.alterNextWrite = (bytes) => bytes.slice(0, bytes.byteLength - 7)

      expect(await go()).toEqual({ kind: 'failed', folder: FOLDER, code: 'unverified' })
      expect(folders.folders()).toEqual([])
    })

    it('refuses a file whose bytes are not the ones that were written', async () => {
      await scene.photo({ id: 'p1' })
      folders.alterNextWrite = (bytes) => {
        const copy = bytes.slice()
        copy[4] = (copy[4] ?? 0) ^ 0xff
        return copy
      }

      expect(await go()).toMatchObject({ kind: 'failed', code: 'unverified' })
      expect(folders.manifestOf(FOLDER)).toBeNull()
    })
  })

  it('reports a write that failed for a reason of the disk as unexpected, and says so in the log', async () => {
    await scene.photo({ id: 'p1' })
    folders.failNextWriteWith = new Error('EIO')

    expect(await go()).toEqual({ kind: 'failed', folder: FOLDER, code: 'unexpected' })
    expect(scene.logger.lines.some((line) => line.message === 'album copy write failed')).toBe(true)
  })

  it('does not let a folder that cannot be cleaned hide the failure it was cleaning after', async () => {
    await scene.photo({ id: 'p1' })
    scene.photos.countsByStatus = async () => {
      throw 'not even an Error'
    }
    folders.delete = async () => {
      throw new Error('read-only file system')
    }

    expect(await go()).toEqual({ kind: 'failed', folder: FOLDER, code: 'unexpected' })
  })

  it('reports an unexpected failure as one and leaves nothing behind', async () => {
    await scene.photo({ id: 'p1' })
    scene.photos.countsByStatus = async () => {
      throw new Error('database is locked')
    }

    expect(await go()).toEqual({ kind: 'failed', folder: FOLDER, code: 'unexpected' })
    expect(folders.folders()).toEqual([])
  })

  describe('a re-run over an earlier verified copy', () => {
    const firstGood = async (): Promise<{ zip: Uint8Array; manifest: string }> => {
      await scene.photo({ id: 'p1' })
      expect(await go()).toMatchObject({ kind: 'written' })
      return {
        zip: folders.bytesOf(FOLDER) ?? new Uint8Array(),
        manifest: folders.manifestOf(FOLDER) ?? '',
      }
    }

    it('replaces it by the new verified copy, and leaves no staging behind', async () => {
      await firstGood()
      await scene.photo({ id: 'p2', createdAt: atPlus(1_000_000) })

      expect(await go()).toMatchObject({ kind: 'written' })

      expect(folders.folders()).toEqual([FOLDER])
      expect(folders.manifestOf(FOLDER)).toContain('0002-')
    })

    it.each([
      [
        'a write that fails',
        () => {
          folders.failNextWriteWith = new Error('ENOSPC')
        },
        'unexpected',
      ],
      [
        'a file read back short',
        () => {
          folders.alterNextWrite = (b) => b.slice(0, b.byteLength - 7)
        },
        'unverified',
      ],
    ] as const)(
      'keeps the previous copy and its manifest when %s',
      async (_name, arrange, code) => {
        const before = await firstGood()
        arrange()

        expect(await go()).toMatchObject({ kind: 'failed', code })

        expect(folders.bytesOf(FOLDER)).toEqual(before.zip)
        expect(folders.manifestOf(FOLDER)).toBe(before.manifest)
        expect(folders.folders()).toEqual([FOLDER])
      },
    )

    it('keeps the previous copy when the album changed under the write', async () => {
      const before = await firstGood()
      const list = scene.photos.list.bind(scene.photos)
      let pages = 0
      scene.photos.list = async (...args) => {
        const page = await list(...args)
        pages += 1
        if (pages === 1) await scene.photo({ id: 'late', createdAt: atPlus(9_000_000) })
        return page
      }

      expect(await go()).toMatchObject({ kind: 'failed', code: 'stale' })

      expect(folders.bytesOf(FOLDER)).toEqual(before.zip)
      expect(folders.manifestOf(FOLDER)).toBe(before.manifest)
    })
  })
})
