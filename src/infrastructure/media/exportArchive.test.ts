import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm, stat, truncate } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ExportFileStore } from '../../application/ports/exportFileStore'
import { aPhoto, anEvent, atPlus } from '../../application/testing/builders'
import { CapturingLogger } from '../../application/testing/capturingLogger'
import { FakeClientRepository } from '../../application/testing/fakeClientRepository'
import { FakeClipJobRepository } from '../../application/testing/fakeClipJobRepository'
import { FakeClock } from '../../application/testing/fakeClock'
import { FakeEventRepository } from '../../application/testing/fakeEventRepository'
import { RecordingEventBus } from '../../application/testing/recordingEventBus'
import {
  makeBuildNextAlbumExport,
  type BuildNextAlbumExport,
} from '../../application/usecases/exports/buildNextAlbumExport'
import { requestExport } from '../../domain/exports/albumExport'
import { readZipEnd, ZIP_TAIL_BYTES } from '../../domain/exports/zipEndRecord'
import { asEventId, asUserId } from '../../domain/shared/ids'
import { sha256StreamHasher } from '../crypto/sha256StreamHasher'
import { closeDatabase, openDatabase, type Db } from '../db/connection'
import { migrate } from '../db/migrator'
import { migrations } from '../db/migrations'
import { SqliteAlbumExportRepository } from '../db/sqliteAlbumExportRepository'
import { SqliteGuestRepository } from '../db/sqliteGuestRepository'
import { SqliteGuestbookRepository } from '../db/sqliteGuestbookRepository'
import { SqliteGuestbookVoiceRepository } from '../db/sqliteGuestbookVoiceRepository'
import { SqlitePhotoRepository } from '../db/sqlitePhotoRepository'
import { archiverWriter } from './archiverWriter'
import { createFsExportFileStore } from './fsExportFileStore'
import { createFsMediaStore } from './fsMediaStore'
import { seedAlbumRows } from './testing/archiveRig'

/**
 * The box's own verified archive with the real pieces under it (spec 22, ring 3): `archiver`
 * writing the ZIP, the filesystem store keeping it in `.exports`, SQLite for the rows and the real
 * SHA-256. A fake writer would prove nothing about whether the file it ends with can be read back by
 * the end record, and a fake store nothing about a file that a disk truncated.
 */

const WEDDING = asEventId('evt-wedding')
const HOST = asUserId('user-owner')
const PHOTOS = 5
const PHOTO_BYTES = 200_000

interface Rig {
  readonly db: Db
  readonly root: string
  readonly exportFiles: ExportFileStore
  readonly exports: SqliteAlbumExportRepository
  readonly build: BuildNextAlbumExport
}

/** The names the central directory of a ZIP lists, read by hand, in order. */
const entryNamesOf = (zip: Buffer): readonly string[] => {
  const end = zip.length - 22
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const names: string[] = []
  for (let n = 0; n < count; n += 1) {
    const nameLength = zip.readUInt16LE(at + 28)
    const extraLength = zip.readUInt16LE(at + 30)
    const commentLength = zip.readUInt16LE(at + 32)
    names.push(zip.toString('utf8', at + 46, at + 46 + nameLength))
    at += 46 + nameLength + extraLength + commentLength
  }
  return names
}

describe('the verified archive with the real archiver, filesystem and database', () => {
  let rig: Rig

  /** A rig whose store may be wrapped: what a disk does to a file after it has been written. */
  const makeRig = async (wrap?: (store: ExportFileStore, root: string) => ExportFileStore) => {
    const db = openDatabase({ path: ':memory:' })
    migrate(db, migrations)
    seedAlbumRows(db)
    const root = await mkdtemp(join(tmpdir(), 'eventslide-export-archive-'))
    const photos = new SqlitePhotoRepository(db)
    const media = createFsMediaStore({ root })
    for (let index = 0; index < PHOTOS; index += 1) {
      const photo = aPhoto({
        id: `photo-${String(index).padStart(3, '0')}`,
        eventId: WEDDING,
        status: 'published',
        createdAt: atPlus(index),
      })
      await photos.save(photo)
      await media.put(WEDDING, photo.contentHash, 'original', new Uint8Array(PHOTO_BYTES).fill(index))
    }
    const events = new FakeEventRepository()
    events.seed(anEvent({ id: WEDDING, slug: 'camille-et-sacha', status: 'closed' }))
    const exports = new SqliteAlbumExportRepository(db)
    const base = createFsExportFileStore(root)
    const exportFiles = wrap === undefined ? base : wrap(base, root)
    const clock = new FakeClock(atPlus(60 * 60_000))
    rig = {
      db,
      root,
      exportFiles,
      exports,
      build: makeBuildNextAlbumExport({
        events,
        clients: new FakeClientRepository(),
        guests: new SqliteGuestRepository(db),
        guestbook: new SqliteGuestbookRepository(db),
        voices: new SqliteGuestbookVoiceRepository(db),
        photos,
        media,
        archive: archiverWriter,
        streamHasher: sha256StreamHasher,
        exports,
        exportFiles,
        clips: new FakeClipJobRepository(),
        bus: new RecordingEventBus(),
        clock,
        logger: new CapturingLogger(),
        policy: {
          maxBytes: 100_000_000,
          ttlDays: 7,
          maxTotalBytes: 1_000_000_000,
          maxWaitMs: 600_000,
          capNoticeDays: 30,
          minFreeDiskBytes: 0,
        },
        freeDiskBytes: async () => 10_000_000_000,
      }),
    }
    await exports.request(requestExport(WEDDING, HOST, clock.now()))
  }

  afterEach(async () => {
    closeDatabase(rig.db)
    await rm(rig.root, { recursive: true, force: true })
  })

  const zipOnDisk = (): Buffer => readFileSync(join(rig.root, '.exports', `${WEDDING}.zip`))

  describe('a file that is what it says', () => {
    beforeEach(() => makeRig())

    it('is sealed with the digest and the size of the file on the disk', async () => {
      const outcome = await rig.build()

      expect(outcome).toMatchObject({ kind: 'sealed', entries: PHOTOS, skipped: 0 })
      const zip = zipOnDisk()
      expect(await rig.exports.find(WEDDING)).toMatchObject({
        status: 'sealed',
        entries: PHOTOS,
        bytes: zip.length,
        sha256: createHash('sha256').update(zip).digest('hex'),
      })
    })

    it('is a ZIP whose end record announces the photographs and the manifest, which closes it', async () => {
      await rig.build()

      const zip = zipOnDisk()
      expect(readZipEnd(zip.subarray(Math.max(0, zip.length - ZIP_TAIL_BYTES)))).toEqual({
        entries: PHOTOS + 1,
      })
      const names = entryNamesOf(zip)
      expect(names).toHaveLength(PHOTOS + 1)
      expect(names.at(-1)).toBe('camille-et-sacha/MANIFEST.sha256')
    })

    it('carries a manifest whose digests are those of the bytes on the disk, and says nothing was missing', async () => {
      await rig.build()

      const text = zipOnDisk().toString('latin1')
      const digests = [...text.matchAll(/([0-9a-f]{64}) {2}(\d{4}-[0-9a-f]{12}\.jpg)\n/g)].map(
        (match) => match[1],
      )
      const expected = Array.from({ length: PHOTOS }, (_, index) =>
        createHash('sha256')
          .update(new Uint8Array(PHOTO_BYTES).fill(index))
          .digest('hex'),
      )
      expect([...digests].sort()).toEqual([...expected].sort())
      expect(text).toContain('# missing: 0')
    })

    it('leaves no temporary file, and keeps the archive out of the event’s own folder', async () => {
      await rig.build()

      expect(await readdir(join(rig.root, '.exports', '.tmp'))).toEqual([])
      expect(await readdir(join(rig.root, '.exports'))).toContain(`${WEDDING}.zip`)
      expect((await readdir(join(rig.root, WEDDING))).sort()).not.toContain(`${WEDDING}.zip`)
    })
  })

  describe('a file the disk damaged after the write reported every byte', () => {
    const damaging =
      (damage: (path: string) => Promise<void>) =>
      (store: ExportFileStore, root: string): ExportFileStore => ({
        ...store,
        write: async (eventId, bytes, options) => {
          const size = await store.write(eventId, bytes, options)
          await damage(join(root, '.exports', `${eventId}.zip`))
          return size
        },
      })

    it('refuses a ZIP cut short by hand: nothing is sealed and the file is gone', async () => {
      await makeRig(
        damaging(async (path) => {
          await truncate(path, (await stat(path)).size - 30)
        }),
      )

      const outcome = await rig.build()

      expect(outcome).toEqual({ kind: 'failed', eventId: WEDDING, code: 'unverified' })
      expect(await rig.exports.find(WEDDING)).toMatchObject({ status: 'failed', sha256: null })
      expect(await readdir(join(rig.root, '.exports'))).not.toContain(`${WEDDING}.zip`)
    })

    it('refuses a ZIP of the right size whose end record was overwritten', async () => {
      await makeRig(
        damaging(async (path) => {
          const { open } = await import('node:fs/promises')
          const handle = await open(path, 'r+')
          try {
            const { size } = await handle.stat()
            await handle.write(new Uint8Array(22), 0, 22, size - 22)
          } finally {
            await handle.close()
          }
        }),
      )

      expect(await rig.build()).toMatchObject({ kind: 'failed', code: 'unverified' })
    })
  })
})
