import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { aPhoto, AT, atPlus } from '../../application/testing/builders'
import { buildGalleryWorld, WEDDING, type GalleryWorld } from '../../application/testing/galleryWorld'
import { grantArchive } from '../../application/usecases/gallery/galleryAccess'
import {
  makeDownloadGalleryArchive,
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

/**
 * The shared gallery's ZIP with the real pieces under it (roadmap §4.1): `archiver`, the
 * filesystem store and SQLite.
 *
 * Both cases here are about how those pieces behave together and were green against the
 * fakes while broken for real. The recording archive writer pulls one entry at a time,
 * `archiver` queues every entry it is handed at once; the fake photo repository hands
 * back arrays, better-sqlite3 keeps a statement iterating across every `await` of a
 * streamed read and refuses writes on the connection until it finishes. A test of the
 * revocation promise or of the box staying writable that runs on the fakes proves
 * neither.
 */

const HOUR = 60 * 60 * 1000
const PHOTO_BYTES = 256 * 1024
const ISO_AT = AT.toISOString()

interface Rig {
  readonly world: GalleryWorld
  readonly db: Db
  readonly photos: PhotoRepository
  readonly media: MediaStore
  readonly root: string
  /** Resolves once every photograph of the album has been listed — sized, not read. */
  readonly listed: Promise<void>
  input(): DownloadGalleryArchiveInput
  download(): ReturnType<ReturnType<typeof makeDownloadGalleryArchive>>
}

const seedForeignRows = (db: Db): void => {
  db.prepare(
    `INSERT INTO users (id, email, password_hash, created_at)
          VALUES ('user-owner', 'hote@example.test', 'hash:x', '${ISO_AT}')`,
  ).run()
  for (const id of ['evt-wedding', 'evt-gala']) {
    db.prepare(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                           created_at)
            VALUES ('${id}', 'user-owner', '${id}', '${id}', '${id}', 'closed', '{}',
                    100000000000, '${ISO_AT}')`,
    ).run()
  }
  db.prepare(
    `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at)
          VALUES ('guest-1', 'evt-wedding', NULL, '${ISO_AT}', '${ISO_AT}'),
                 ('guest-gala', 'evt-gala', NULL, '${ISO_AT}', '${ISO_AT}')`,
  ).run()
}

describe('the gallery archive with the real archiver, filesystem and database', () => {
  let rig: Rig

  beforeEach(async () => {
    const world = buildGalleryWorld()
    const db = openDatabase({ path: ':memory:' })
    migrate(db, migrations)
    seedForeignRows(db)
    const root = await mkdtemp(join(tmpdir(), 'eventslide-gallery-archive-'))
    const photos = new SqlitePhotoRepository(db)
    const store = createFsMediaStore({ root })
    const { link } = world.seedLink()

    for (let index = 0; index < 40; index += 1) {
      const photo = aPhoto({
        id: `photo-${String(index).padStart(3, '0')}`,
        eventId: WEDDING,
        status: 'published',
        createdAt: atPlus(index),
      })
      await photos.save(photo)
      await store.put(WEDDING, photo.contentHash, 'original', new Uint8Array(PHOTO_BYTES).fill(index))
    }

    // Counts the sizing reads the listing makes, so a test can wait until the whole album
    // has been handed to the writer — the moment after which a check made while listing
    // can no longer stop anything.
    let sized = 0
    let finishListing = (): void => undefined
    const listed = new Promise<void>((resolve) => {
      finishListing = resolve
    })
    const media: MediaStore = {
      ...store,
      stat: async (...args) => {
        const found = await store.stat(...args)
        sized += 1
        if (sized === 40) finishListing()
        return found
      },
    }

    const deps = { ...world, photos, media, archive: archiverWriter }
    rig = {
      world,
      db,
      photos,
      media,
      root,
      listed,
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
    // Measured before the fix: revoked after the first chunk, the archive still ended
    // cleanly with every byte of the album, because `archiver` had been handed every
    // entry — and every check — before the first byte was written. So the revoke here
    // waits until the whole album has been listed: a check that only runs while listing
    // has nothing left to say by then, and this is what tells the two apart.
    const result = await rig.download()
    if (!result.ok) throw new Error(`expected an archive, got ${result.error.code}`)

    let received = 0
    let revoked = false
    const consume = async (): Promise<void> => {
      for await (const chunk of result.value.chunks) {
        received += chunk.length
        if (!revoked) {
          revoked = true
          await rig.listed
          await rig.world.shareLinks.revokeCurrent(WEDDING, rig.world.clock.now())
        }
      }
    }

    await expect(consume()).rejects.toThrow()
    expect(received).toBeLessThan(40 * PHOTO_BYTES)
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
    expect(total).toBeGreaterThan(40 * PHOTO_BYTES)
  })
})
