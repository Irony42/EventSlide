import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aPhoto, atPlus } from '../../application/testing/builders'
import { buildGalleryWorld, WEDDING, type GalleryWorld } from '../../application/testing/galleryWorld'
import { grantArchive } from '../../application/usecases/gallery/galleryAccess'
import {
  makeDownloadGalleryArchive,
  ShareLinkWithdrawnError,
  type DownloadGalleryArchiveInput,
} from '../../application/usecases/gallery/downloadGalleryArchive'
import type { MediaStore } from '../../application/ports/mediaStore'
import type { PhotoRepository } from '../../application/ports/photoRepository'
import { closeDatabase, openDatabase, type Db } from '../db/connection'
import { migrate } from '../db/migrator'
import { migrations } from '../db/migrations'
import { SqlitePhotoRepository } from '../db/sqlitePhotoRepository'
import { archiverWriter } from './archiverWriter'
import { createFsMediaStore } from './fsMediaStore'
import { countingOpenFiles, seedAlbumRows, type OpenFiles } from './testing/archiveRig'

/**
 * The shared gallery's ZIP with the real pieces under it (roadmap §4.1): `archiver`, the
 * filesystem store and SQLite.
 *
 * Every case here is about how those pieces behave together and was green against the
 * fakes while broken for real. The recording archive writer pulls one entry at a time,
 * `archiver` queued every entry it was handed at once, and left every one of them open when
 * a client went away; the fake photo repository hands back arrays, better-sqlite3 keeps a
 * statement iterating across every `await` of a streamed read and refuses writes on the
 * connection until it finishes. A test of the revocation promise, of the files a download
 * leaves open or of the box staying writable that runs on the fakes proves none of them.
 */

const HOUR = 60 * 60 * 1000
/**
 * Twelve photographs of 3 MiB each. A photograph has to be larger than everything the writer
 * and `archiver` buffer between them, a megabyte or two: smaller, and a file left open by a
 * download that was abandoned is read to its end into those buffers and closes on its own,
 * so the leak these tests exist for would not show.
 */
const PHOTOS = 12
const PHOTO_BYTES = 3 * 1024 * 1024

interface Rig {
  readonly world: GalleryWorld
  readonly db: Db
  readonly photos: PhotoRepository
  readonly media: MediaStore
  readonly root: string
  /** The files the download opened, and how many of them have been closed since. */
  readonly files: OpenFiles
  input(): DownloadGalleryArchiveInput
  download(): ReturnType<ReturnType<typeof makeDownloadGalleryArchive>>
}

describe('the gallery archive with the real archiver, filesystem and database', () => {
  let rig: Rig

  beforeEach(async () => {
    const world = buildGalleryWorld()
    const db = openDatabase({ path: ':memory:' })
    migrate(db, migrations)
    seedAlbumRows(db)
    const root = await mkdtemp(join(tmpdir(), 'eventslide-gallery-archive-'))
    const photos = new SqlitePhotoRepository(db)
    const store = createFsMediaStore({ root })
    const { link } = world.seedLink()

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

    const { store: media, files } = countingOpenFiles(store)

    const deps = { ...world, photos, media, archive: archiverWriter }
    rig = {
      world,
      db,
      photos,
      media,
      root,
      files,
      input: () => {
        const grant = grantArchive(world.signer, link.id, atPlus(HOUR))
        return {
          linkId: grant.linkId,
          expiresAtMs: grant.expiresAt.getTime(),
          signature: grant.signature,
        }
      },
      download: () => makeDownloadGalleryArchive(deps)(rig.input()),
    }
  })

  afterEach(async () => {
    closeDatabase(rig.db)
    await rm(rig.root, { recursive: true, force: true })
  })

  it('stops the download at the next photograph once the link is revoked', async () => {
    // The link is read again when each photograph's bytes are about to be sent, not once
    // for the download: a wedding is gigabytes and minutes, and "revoke is immediate" has to
    // hold for the download already in flight. Measured before the fix to the writer, a
    // link revoked after the first chunk still delivered the whole album, because
    // `archiver` had been handed every entry — and every check — before a byte was written.
    // The writer now asks for an entry only when it is about to write it, so there is no
    // whole-album listing to wait for: what is left to tell is a check made once from a
    // check made for every photograph, and the second is the one that ends this with an
    // error and a fraction of the album rather than with a clean ZIP of all twelve.
    const result = await rig.download()
    if (!result.ok) throw new Error(`expected an archive, got ${result.error.code}`)

    let received = 0
    let revoked = false
    const consume = async (): Promise<void> => {
      for await (const chunk of result.value.chunks) {
        received += chunk.length
        if (!revoked) {
          revoked = true
          await rig.world.shareLinks.revokeCurrent(WEDDING, rig.world.clock.now())
        }
      }
    }

    await expect(consume()).rejects.toThrow(ShareLinkWithdrawnError)
    // Half the album is generous: what was already written when the link was revoked is
    // what the writer's own buffers hold, a photograph or two of twelve.
    expect(received).toBeLessThan((PHOTOS / 2) * PHOTO_BYTES)
  })

  it('closes every file it opened when the client stops reading', async () => {
    // The tab was closed with the album half sent. The writer used to take every
    // photograph at once and open every file, then leave them open: 55 of 60 measured on
    // the real filesystem, a descriptor each for as long as the process lived, for anybody
    // holding a gallery link.
    const result = await rig.download()
    if (!result.ok) throw new Error(`expected an archive, got ${result.error.code}`)

    // The first chunk is a ZIP header, written before any file is opened, so read on until
    // the writer is into the album: three photographs have been opened.
    for await (const _chunk of result.value.chunks) {
      if (rig.files.opened >= 3) break
    }

    await vi.waitFor(() => expect(rig.files.closed).toBe(rig.files.opened), { timeout: 2_000 })
    expect(rig.files.opened).toBeGreaterThan(0)
    expect(rig.files.opened).toBeLessThan(PHOTOS)
  })

  it('leaves the database writable for every other event while an archive is listed', async () => {
    // Measured before the fix: a streamed read held one better-sqlite3 statement open
    // across each `await` of a download, and the connection refused every write until it
    // ended — 600 of 602 uploads on another event failed during one archive.
    const result = await rig.download()
    if (!result.ok) throw new Error(`expected an archive, got ${result.error.code}`)

    const failures: string[] = []
    const upload = async (): Promise<void> => {
      for (let index = 0; index < 30; index += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve))
        try {
          await rig.photos.save(
            aPhoto({
              id: `gala-${index}`,
              eventId: 'evt-gala',
              author: { kind: 'guest', id: 'guest-gala' },
            }),
          )
        } catch (cause) {
          failures.push(cause instanceof Error ? cause.message : String(cause))
        }
      }
    }
    const consume = async (): Promise<number> => {
      let total = 0
      for await (const chunk of result.value.chunks) total += chunk.length
      return total
    }

    const [total] = await Promise.all([consume(), upload()])

    expect(failures).toEqual([])
    expect(total).toBeGreaterThan(PHOTOS * PHOTO_BYTES)
  })
})
