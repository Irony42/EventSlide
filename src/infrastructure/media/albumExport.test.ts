import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aPhoto, anEvent, atPlus } from '../../application/testing/builders'
import { FakeEventRepository } from '../../application/testing/fakeEventRepository'
import { CapturingLogger } from '../../application/testing/capturingLogger'
import { makeExportAlbum, type ExportAlbum } from '../../application/usecases/photos/exportAlbum'
import { asEventId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from '../db/connection'
import { migrate } from '../db/migrator'
import { migrations } from '../db/migrations'
import { SqliteGuestRepository } from '../db/sqliteGuestRepository'
import { SqliteGuestbookRepository } from '../db/sqliteGuestbookRepository'
import { SqlitePhotoRepository } from '../db/sqlitePhotoRepository'
import { archiverWriter } from './archiverWriter'
import { createFsMediaStore } from './fsMediaStore'
import { countingOpenFiles, seedAlbumRows, type OpenFiles } from './testing/archiveRig'

/**
 * The host's own album ZIP with the real pieces under it: `archiver`, the filesystem
 * store and SQLite — the download `GET /events/:slug/album.zip` serves.
 *
 * The two cases are one change seen from both sides. The writer asks for an entry only
 * when it is about to write it, which is what lets a client that goes away leave nothing
 * open; and it is also what would keep the listing's database statement open for as long
 * as a host's download lasts, unless the listing is read in pages. Each is green against
 * the fakes and wrong against these.
 */

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
/**
 * Twelve photographs of 3 MiB each. A photograph has to be larger than everything the writer
 * and `archiver` buffer between them, a megabyte or two: smaller, and a file left open by a
 * download that was abandoned is read to its end into those buffers and closes on its own,
 * so the leak these tests exist for would not show.
 */
const PHOTOS = 12
const PHOTO_BYTES = 3 * 1024 * 1024

interface Rig {
  readonly db: Db
  readonly photos: SqlitePhotoRepository
  readonly files: OpenFiles
  readonly root: string
  readonly exportAlbum: ExportAlbum
}

describe('the host’s album with the real archiver, filesystem and database', () => {
  let rig: Rig

  beforeEach(async () => {
    const db = openDatabase({ path: ':memory:' })
    migrate(db, migrations)
    seedAlbumRows(db)
    const root = await mkdtemp(join(tmpdir(), 'eventslide-album-export-'))
    const photos = new SqlitePhotoRepository(db)
    const store = createFsMediaStore({ root })

    for (let index = 0; index < PHOTOS; index += 1) {
      const photo = aPhoto({
        id: `photo-${String(index).padStart(3, '0')}`,
        eventId: WEDDING,
        status: 'published',
        createdAt: atPlus(index),
      })
      await photos.save(photo)
      await store.put(WEDDING, photo.contentHash, 'original', new Uint8Array(PHOTO_BYTES).fill(index))
    }

    const events = new FakeEventRepository()
    events.seed(anEvent({ id: WEDDING, slug: 'camille-et-sacha' }))
    const { store: media, files } = countingOpenFiles(store)

    rig = {
      db,
      photos,
      files,
      root,
      exportAlbum: makeExportAlbum({
        events,
        photos,
        guestbook: new SqliteGuestbookRepository(db),
        guests: new SqliteGuestRepository(db),
        media,
        archive: archiverWriter,
        logger: new CapturingLogger(),
      }),
    }
  })

  afterEach(async () => {
    closeDatabase(rig.db)
    await rm(rig.root, { recursive: true, force: true })
  })

  const download = async (): Promise<AsyncIterable<Uint8Array>> => {
    const result = await rig.exportAlbum({ eventId: WEDDING })
    if (!result.ok) throw new Error(`expected an archive, got ${result.error.code}`)
    return result.value
  }

  it('leaves the database writable for every other event while a host downloads slowly', async () => {
    // A host on venue Wi-Fi reads the ZIP at a trickle, for minutes, while guests at the
    // party next door keep uploading. The listing used to be one better-sqlite3 statement
    // iterating across every `await`, which was harmless while the writer listed the whole
    // album at once; once the writer lists only as fast as the client reads, that
    // statement is open for the whole download and the connection refuses every write.
    const chunks = (await download())[Symbol.asyncIterator]()
    await chunks.next()
    // The client has stopped reading; the writer is blocked on it, mid-album.
    await new Promise<void>((resolve) => setTimeout(resolve, 100))

    await expect(
      rig.photos.save(
        aPhoto({
          id: 'gala-1',
          eventId: GALA,
          author: { kind: 'guest', id: 'guest-gala' },
        }),
      ),
    ).resolves.toBeUndefined()

    let total = 0
    for (let next = await chunks.next(); next.done !== true; next = await chunks.next()) {
      total += next.value.length
    }
    expect(total).toBeGreaterThan((PHOTOS - 2) * PHOTO_BYTES)
  })

  it('keeps one file open at a time while it writes the album', async () => {
    // The previous file's `close` is an event still on its way when the next is opened, so
    // two is the most a correct writer can show; one that took the album at once shows all
    // twelve, and four thousand open files is a host whose download dies of EMFILE.
    for await (const _chunk of await download()) {
      // Reading it all is the point.
    }

    expect(rig.files.opened).toBe(PHOTOS)
    expect(rig.files.mostOpen).toBeLessThanOrEqual(2)
  })

  it('closes every file it opened when the host stops reading', async () => {
    // The host closes the tab with the album half downloaded. Four thousand photographs
    // were four thousand files opened as the listing went by, and left open.
    for await (const _chunk of await download()) {
      if (rig.files.opened >= 3) break
    }

    await vi.waitFor(() => expect(rig.files.closed).toBe(rig.files.opened), { timeout: 2_000 })
    expect(rig.files.opened).toBeGreaterThan(0)
    expect(rig.files.opened).toBeLessThan(PHOTOS)
  })
})
