import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ARCHIVE_FORMAT,
  BackupError,
  createBackup,
  DATABASE_FILE,
  inspectRestoreTarget,
  MANIFEST_FILE,
  MEDIA_DIR,
  readManifest,
  resolveInside,
  restoreBackup,
  verifyBackup,
  type BackupManifest,
  type ManifestEntry,
} from './backupArchive'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate, type Migration } from './migrator'

/**
 * Ring 3: a real SQLite file on disk and a real media root, because both halves of
 * what is under test are I/O. A `:memory:` database cannot be VACUUMed INTO a path,
 * and the trap this module exists to avoid — a WAL whose contents are not in the
 * `.sqlite` file — only exists on a real file.
 */

const EVENT = '11111111-1111-4111-8111-111111111111'
const OTHER_EVENT = '22222222-2222-4222-8222-222222222222'
const VARIANTS = ['original', 'display', 'thumb'] as const

const NOW = new Date('2026-09-11T21:30:00.000Z')

const hashOf = (seed: string): string => createHash('sha256').update(seed).digest('hex')

const sha256OfFile = async (path: string): Promise<string> =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  )

describe('backup and restore', () => {
  let root: string
  let databasePath: string
  let mediaRoot: string
  let archive: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eventslide-backup-'))
    databasePath = join(root, 'eventslide.sqlite')
    mediaRoot = join(root, 'media')
    archive = join(root, 'archive')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  // ------------------------------------------------------------- fixtures --

  const openLive = (): Db => {
    const db = openDatabase({ path: databasePath })
    migrate(db, migrations)
    return db
  }

  const insertOwner = (db: Db, id = 'user-1'): void => {
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, created_at, must_change_password)
       VALUES (?, ?, 'Camille', 'not-a-real-hash', '2026-09-01T10:00:00.000Z', 0)`,
    ).run(id, `${id}@eventslide.test`)
  }

  const insertEvent = (db: Db, id = EVENT, slug = 'camille-et-sacha'): void => {
    db.prepare(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings,
                           quota_bytes, created_at)
       VALUES (?, 'user-1', 'Camille & Sacha', ?, ?, 'live', '{"moderation":"manual"}',
               5000000000, '2026-09-01T10:00:00.000Z')`,
    ).run(id, slug, slug.slice(0, 6).toUpperCase())
  }

  const insertGuest = (db: Db, id: string, eventId = EVENT): void => {
    db.prepare(
      `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at)
       VALUES (?, ?, 'Lea', '2026-09-01T20:00:00.000Z', '2026-09-01T20:00:00.000Z')`,
    ).run(id, eventId)
  }

  const insertPhoto = (
    db: Db,
    input: { id: string; eventId?: string; guestId: string; contentHash: string },
  ): void => {
    db.prepare(
      `INSERT INTO photos (id, event_id, author_guest_id, status, content_hash,
                           width, height, byte_size, created_at)
       VALUES (?, ?, ?, 'published', ?, 1600, 1200, 1234, '2026-09-01T20:05:00.000Z')`,
    ).run(input.id, input.eventId ?? EVENT, input.guestId, input.contentHash)
  }

  /** Lays bytes down exactly where `fsMediaStore` would put them. */
  const writeMedia = async (
    eventId: string,
    contentHash: string,
    variant: string,
    bytes: string,
  ): Promise<string> => {
    const directory = join(mediaRoot, eventId, variant, contentHash.slice(0, 2))
    await mkdir(directory, { recursive: true })
    const path = join(directory, `${contentHash}.jpg`)
    await writeFile(path, bytes)
    return path
  }

  const writeAllVariants = async (
    eventId: string,
    contentHash: string,
    label: string,
  ): Promise<void> => {
    for (const variant of VARIANTS) {
      await writeMedia(eventId, contentHash, variant, `${label}-${variant}-bytes`)
    }
  }

  /** One owner, one event, one guest, one published photo with all three variants. */
  const seedAnEvening = async (): Promise<{ contentHash: string }> => {
    const db = openLive()
    insertOwner(db)
    insertEvent(db)
    insertGuest(db, 'guest-1')
    const contentHash = hashOf('confettis')
    insertPhoto(db, { id: 'photo-1', guestId: 'guest-1', contentHash })
    closeDatabase(db)
    await writeAllVariants(EVENT, contentHash, 'confettis')
    return { contentHash }
  }

  const backup = (overrides: { destination?: string; now?: Date } = {}) =>
    createBackup({
      databasePath,
      mediaRoot,
      destination: overrides.destination ?? archive,
      now: overrides.now ?? NOW,
      appVersion: '2.0.0',
    })

  const verify = (target = archive, deep = true) => verifyBackup(target, { deep, migrations })

  const restore = (options: { force?: boolean; from?: string } = {}) =>
    restoreBackup({
      archive: options.from ?? archive,
      databasePath,
      mediaRoot,
      force: options.force ?? false,
      migrations,
    })

  const rewriteManifest = async (
    change: (manifest: BackupManifest) => BackupManifest,
  ): Promise<void> => {
    const manifest = await readManifest(archive)
    await writeFile(join(archive, MANIFEST_FILE), JSON.stringify(change(manifest), null, 2), 'utf8')
  }

  // -------------------------------------------------------------- backup --

  describe('createBackup', () => {
    it('captures rows that are still only in the write-ahead log', async () => {
      // The reason this module exists. The connection stays open and is never
      // checkpointed, so in WAL mode these rows live in `-wal` and not in the
      // `.sqlite` file at all. A backup that copied the file — which is what
      // docs/SECURITY.md §11 used to warn about — would restore an evening that
      // never happened.
      const db = openLive()
      insertOwner(db)
      insertEvent(db)
      insertGuest(db, 'guest-1')
      insertPhoto(db, { id: 'photo-1', guestId: 'guest-1', contentHash: hashOf('a') })

      const { manifest } = await backup()
      closeDatabase(db)

      expect(manifest.counts.events).toBe(1)
      expect(manifest.counts.photos).toBe(1)
      expect(manifest.counts.guests).toBe(1)
      expect(manifest.database.integrityCheck).toBe('ok')
    })

    it('writes a manifest, a database snapshot and the media tree', async () => {
      const { contentHash } = await seedAnEvening()

      const { manifest, destination } = await backup()

      expect(destination).toContain('archive')
      expect(manifest.format).toBe(ARCHIVE_FORMAT)
      expect(manifest.createdAt).toBe(NOW.toISOString())
      expect(await exists(join(archive, MANIFEST_FILE))).toBe(true)
      expect(await exists(join(archive, DATABASE_FILE))).toBe(true)
      for (const variant of VARIANTS) {
        const copied = join(
          archive,
          MEDIA_DIR,
          EVENT,
          variant,
          contentHash.slice(0, 2),
          `${contentHash}.jpg`,
        )
        expect(await exists(copied)).toBe(true)
      }
      expect(manifest.counts.mediaFiles).toBe(3)
      expect(manifest.media.entries).toHaveLength(3)
    })

    it('records the migration ledger so the archive can be matched to a build', async () => {
      await seedAnEvening()

      const { manifest } = await backup()

      expect(manifest.migrations.map((row) => row.id)).toEqual(migrations.map((row) => row.id))
    })

    it('refuses a destination that already holds something', async () => {
      await seedAnEvening()
      await mkdir(archive, { recursive: true })
      await writeFile(join(archive, 'an-older-backup.txt'), 'precious')

      await expect(backup()).rejects.toThrow(/already exists and is not empty/)
      // The older archive is still there: refusing is worth nothing if it half-ran.
      expect(await readFile(join(archive, 'an-older-backup.txt'), 'utf8')).toBe('precious')
    })

    it('refuses when there is no database to back up', async () => {
      await expect(backup()).rejects.toThrow(BackupError)
      await expect(backup()).rejects.toThrow(/There is no database file at/)
    })

    it('refuses a --database that names a directory rather than the file inside it', async () => {
      await mkdir(databasePath, { recursive: true })

      await expect(backup()).rejects.toThrow(/There is no database file at/)
    })

    it('names the photo rows whose bytes were not on disk', async () => {
      // A photo deleted while the backup was running looks exactly like this: the
      // database half was captured first, so the row is in the snapshot and the bytes
      // are already gone. Bounded and reported, rather than discovered at restore.
      const db = openLive()
      insertOwner(db)
      insertEvent(db)
      insertGuest(db, 'guest-1')
      insertPhoto(db, { id: 'photo-1', guestId: 'guest-1', contentHash: hashOf('vanished') })
      closeDatabase(db)

      const { manifest } = await backup()

      expect(manifest.missingMedia).toHaveLength(3)
      expect(manifest.missingMedia.map((gap) => gap.variant).sort()).toEqual([
        'display',
        'original',
        'thumb',
      ])
      expect(manifest.missingMedia[0]?.photoId).toBe('photo-1')
    })

    it('counts bytes that no photo row names, and keeps them', async () => {
      // The other direction of skew: an upload that landed after the database half was
      // captured. Harmless, so it is copied and counted rather than refused.
      await seedAnEvening()
      await writeAllVariants(EVENT, hashOf('arrived-mid-backup'), 'late')

      const { manifest } = await backup()

      expect(manifest.unreferencedMediaFiles).toBe(3)
      expect(manifest.counts.mediaFiles).toBe(6)
      expect((await verify()).ok).toBe(true)
    })

    it('leaves an upload still being staged out of the archive', async () => {
      await seedAnEvening()
      const directory = join(mediaRoot, EVENT, 'original', 'ff')
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'ff.jpg.9f0e-4d21.tmp'), 'half a photo')

      const { manifest } = await backup()

      expect(manifest.counts.mediaFiles).toBe(3)
      expect(manifest.skipped).toHaveLength(1)
      expect(manifest.skipped[0]).toContain('upload in flight')
    })

    it('leaves anything in the media root that is not a regular file, and says so', async () => {
      await seedAnEvening()
      const directory = join(mediaRoot, EVENT, 'original', 'ab')
      await mkdir(directory, { recursive: true })
      // A junction is what a Windows filesystem offers here; the point is an entry the
      // walk must neither copy nor silently drop.
      await symlink(join(directory, 'target'), join(directory, 'a-link'), 'junction')

      const { manifest } = await backup()

      expect(manifest.counts.mediaFiles).toBe(3)
      expect(manifest.skipped.join('\n')).toContain('not a regular file')
    })

    it('refuses when the database cannot be snapshotted', async () => {
      // A typo in --database, or a path pointing at the wrong file. The header is read
      // before a connection is opened, so this is one sentence rather than a driver
      // error — and rather than an archive holding whatever those bytes were.
      await writeFile(databasePath, 'this is not a database')

      await expect(backup()).rejects.toThrow(/is not a SQLite database/)
    })

    it('backs up an installation whose media root does not exist yet', async () => {
      const db = openLive()
      insertOwner(db)
      closeDatabase(db)

      const { manifest } = await backup()

      expect(manifest.counts.mediaFiles).toBe(0)
      expect((await verify()).ok).toBe(true)
    })

    it('keeps two events apart in the archive', async () => {
      const db = openLive()
      insertOwner(db)
      insertEvent(db)
      insertEvent(db, OTHER_EVENT, 'gala')
      closeDatabase(db)
      await writeAllVariants(EVENT, hashOf('wedding'), 'wedding')
      await writeAllVariants(OTHER_EVENT, hashOf('gala'), 'gala')

      const { manifest } = await backup()

      const owners = new Set(manifest.media.entries.map((entry) => entry.path.split('/')[0]))
      expect(owners).toEqual(new Set([EVENT, OTHER_EVENT]))
    })
  })

  // -------------------------------------------------------------- verify --

  describe('verifyBackup', () => {
    it('passes a freshly written archive', async () => {
      await seedAnEvening()
      await backup()

      const report = await verify()

      expect(report.problems).toEqual([])
      expect(report.ok).toBe(true)
      expect(report.checkedFiles).toBe(4)
      expect(report.deep).toBe(true)
    })

    it('does not change the archive it verifies', async () => {
      // Opening the snapshot read-write would set `journal_mode = WAL` and rewrite a
      // byte of the database header, so the file would no longer match the checksum
      // the manifest records — verification would invalidate what it verified.
      await seedAnEvening()
      await backup()
      const before = await sha256OfFile(join(archive, DATABASE_FILE))

      expect((await verify()).ok).toBe(true)
      expect((await verify()).ok).toBe(true)

      expect(await sha256OfFile(join(archive, DATABASE_FILE))).toBe(before)
      expect(await exists(`${join(archive, DATABASE_FILE)}-wal`)).toBe(false)
    })

    it('catches a media file that has been deleted from the archive', async () => {
      const { contentHash } = await seedAnEvening()
      await backup()
      await rm(
        join(archive, MEDIA_DIR, EVENT, 'thumb', contentHash.slice(0, 2), `${contentHash}.jpg`),
      )

      const report = await verify()

      expect(report.ok).toBe(false)
      expect(report.problems.join('\n')).toContain('is missing from the archive')
    })

    it('catches a media file that has been truncated, without hashing anything', async () => {
      const { contentHash } = await seedAnEvening()
      await backup()
      await writeFile(
        join(archive, MEDIA_DIR, EVENT, 'display', contentHash.slice(0, 2), `${contentHash}.jpg`),
        'short',
      )

      const report = await verify(archive, false)

      expect(report.deep).toBe(false)
      expect(report.ok).toBe(false)
      expect(report.problems.join('\n')).toMatch(/bytes, the manifest says/)
    })

    it('catches a flipped byte only on the full check, which is the point of --quick', async () => {
      const { contentHash } = await seedAnEvening()
      await backup()
      const path = join(
        archive,
        MEDIA_DIR,
        EVENT,
        'original',
        contentHash.slice(0, 2),
        `${contentHash}.jpg`,
      )
      const original = await readFile(path, 'utf8')
      // Same length, different bytes: exactly what silent corruption looks like.
      await writeFile(path, `X${original.slice(1)}`)

      expect((await verify(archive, false)).ok).toBe(true)

      const deep = await verify()
      expect(deep.ok).toBe(false)
      expect(deep.problems.join('\n')).toContain('does not match its recorded checksum')
    })

    it('catches a database that is not the one that was backed up', async () => {
      await seedAnEvening()
      await backup()
      const path = join(archive, DATABASE_FILE)
      const bytes = await readFile(path)
      // Corrupt a page in the middle, keeping the length and the SQLite header.
      bytes.fill(0x41, 200, 260)
      await writeFile(path, bytes)

      const report = await verify()

      expect(report.ok).toBe(false)
      expect(report.problems.join('\n')).toContain('is not the one that was backed up')
    })

    it('catches an entry list that has lost rows', async () => {
      await seedAnEvening()
      await backup()
      await rewriteManifest((manifest) => ({
        ...manifest,
        media: { ...manifest.media, entries: manifest.media.entries.slice(0, 1) },
      }))

      const report = await verify()

      expect(report.ok).toBe(false)
      expect(report.problems.join('\n')).toContain('does not match its own digest')
    })

    it('refuses an archive taken by a newer build', async () => {
      await seedAnEvening()
      await backup()
      // Restoring this would boot into the migrator's own "migrated by a newer
      // version" refusal, with the operator's data already overwritten.
      const older: readonly Migration[] = []

      const report = await verifyBackup(archive, { deep: true, migrations: older })

      expect(report.ok).toBe(false)
      expect(report.problems.join('\n')).toContain('newer EventSlide')
    })

    it('refuses an archive whose migration checksum does not match this build', async () => {
      await seedAnEvening()
      await backup()
      const edited = migrations.map((migration) => ({
        ...migration,
        sql: `${migration.sql}\n-- reformatted after it shipped`,
      }))

      const report = await verifyBackup(archive, { deep: true, migrations: edited })

      expect(report.ok).toBe(false)
      expect(report.problems.join('\n')).toContain('not a pair')
    })

    it('warns, without refusing, when the archive predates this build', async () => {
      await seedAnEvening()
      await backup()
      const withANewOne: readonly Migration[] = [
        ...migrations,
        { id: 999, name: 'add_something_later', sql: 'SELECT 1' },
      ]

      const report = await verifyBackup(archive, { deep: true, migrations: withANewOne })

      expect(report.ok).toBe(true)
      expect(report.warnings.join('\n')).toContain('add_something_later')
    })

    it('reports the gaps and the dead weight the backup already recorded', async () => {
      const db = openLive()
      insertOwner(db)
      insertEvent(db)
      insertGuest(db, 'guest-1')
      insertPhoto(db, { id: 'photo-1', guestId: 'guest-1', contentHash: hashOf('vanished') })
      closeDatabase(db)
      await writeAllVariants(EVENT, hashOf('orphan'), 'orphan')
      await backup()

      const report = await verify()

      expect(report.ok).toBe(true)
      expect(report.warnings.join('\n')).toContain('had no bytes on disk')
      expect(report.warnings.join('\n')).toContain('named by no photo row')
    })

    it('says where to point it when there is no manifest', async () => {
      await mkdir(archive, { recursive: true })

      await expect(verify()).rejects.toThrow(/No manifest.json/)
    })

    it('refuses a manifest it cannot parse', async () => {
      await mkdir(archive, { recursive: true })
      await writeFile(join(archive, MANIFEST_FILE), '{ not json')

      await expect(verify()).rejects.toThrow(/not valid JSON/)
    })

    it('refuses a manifest of a format it does not read', async () => {
      await seedAnEvening()
      await backup()
      await rewriteManifest((manifest) => ({ ...manifest, format: 'eventslide-backup/99' }))

      await expect(verify()).rejects.toThrow(/this build reads/)
    })

    it('refuses a manifest missing a field it needs', async () => {
      await seedAnEvening()
      await backup()
      const manifest = await readManifest(archive)
      const { database: _dropped, ...withoutDatabase } = manifest
      await writeFile(join(archive, MANIFEST_FILE), JSON.stringify(withoutDatabase), 'utf8')

      await expect(verify()).rejects.toThrow(/not a manifest this build understands/)
    })

    it('catches a database file that has gone missing entirely', async () => {
      await seedAnEvening()
      await backup()
      await rm(join(archive, DATABASE_FILE))

      const report = await verify()

      expect(report.ok).toBe(false)
      expect(report.problems.join('\n')).toContain('is missing from the archive')
    })

    it('catches a database file of the wrong length without hashing it', async () => {
      await seedAnEvening()
      await backup()
      const path = join(archive, DATABASE_FILE)
      await writeFile(path, (await readFile(path)).subarray(0, 8_192))

      const report = await verify(archive, false)

      expect(report.ok).toBe(false)
      expect(report.problems.join('\n')).toMatch(/database\.sqlite is \d+ bytes, the manifest says/)
    })

    it('catches an archived database whose pages do not hold together', async () => {
      // The manifest is rewritten to match the damaged file, so the length and the
      // checksum both agree: what is left is the question of whether SQLite can still
      // read it. An archive that passes its checksums and will not open is the worst
      // kind, because everything else about it looks fine.
      await seedAnEvening()
      await backup()
      const path = join(archive, DATABASE_FILE)
      await writeFile(path, (await readFile(path)).subarray(0, 8_192))
      const damaged = await readFile(path)
      await rewriteManifest((manifest) => ({
        ...manifest,
        database: {
          ...manifest.database,
          bytes: damaged.byteLength,
          sha256: createHash('sha256').update(damaged).digest('hex'),
        },
      }))

      const report = await verify()

      expect(report.ok).toBe(false)
      expect(report.problems.join('\n')).toMatch(/integrity_check|could not be opened/)
    })

    it('catches a manifest whose ledger disagrees with the archived database', async () => {
      await seedAnEvening()
      await backup()
      await rewriteManifest((manifest) => ({ ...manifest, migrations: [] }))

      const report = await verify()

      expect(report.ok).toBe(false)
      expect(report.problems.join('\n')).toContain('but the archived database has')
    })
  })

  // ------------------------------------------------------------- restore --

  describe('inspectRestoreTarget', () => {
    it('reports an empty target as unoccupied', async () => {
      const target = await inspectRestoreTarget(databasePath, mediaRoot)

      expect(target.occupied).toBe(false)
      expect(target.databaseBytes).toBeNull()
      expect(target.mediaFiles).toBe(0)
      expect(target.liveJournal).toBe(false)
    })

    it('reports what is there, including a journal left by a running server', async () => {
      await seedAnEvening()
      await writeFile(`${databasePath}-wal`, 'pretend write-ahead log')

      const target = await inspectRestoreTarget(databasePath, mediaRoot)

      expect(target.occupied).toBe(true)
      expect(target.databaseBytes).toBeGreaterThan(0)
      expect(target.mediaFiles).toBe(3)
      expect(target.mediaBytes).toBeGreaterThan(0)
      expect(target.liveJournal).toBe(true)
    })
  })

  describe('restoreBackup', () => {
    it('brings back the rows and the bytes after both are destroyed', async () => {
      const { contentHash } = await seedAnEvening()
      const originalThumb = await readFile(
        join(mediaRoot, EVENT, 'thumb', contentHash.slice(0, 2), `${contentHash}.jpg`),
        'utf8',
      )
      await backup()

      await rm(databasePath, { force: true })
      await rm(mediaRoot, { recursive: true, force: true })

      const result = await restore()

      expect(result.mediaFilesWritten).toBe(3)
      expect(result.migrationsApplied).toEqual([])

      const db = openDatabase({ path: databasePath, readonly: true })
      try {
        expect(db.prepare('SELECT COUNT(*) AS n FROM photos').get()).toEqual({ n: 1 })
        expect(db.prepare('SELECT slug FROM events').get()).toEqual({ slug: 'camille-et-sacha' })
      } finally {
        closeDatabase(db)
      }
      expect(
        await readFile(
          join(mediaRoot, EVENT, 'thumb', contentHash.slice(0, 2), `${contentHash}.jpg`),
          'utf8',
        ),
      ).toBe(originalThumb)
    })

    it('leaves the restored database needing no migration, so the server starts', async () => {
      await seedAnEvening()
      await backup()
      await rm(databasePath, { force: true })
      await rm(mediaRoot, { recursive: true, force: true })
      await restore()

      // Exactly what src/main/container.ts does at boot. A ledger that came back
      // wrong throws here rather than serving a wall that never comes up.
      const db = openDatabase({ path: databasePath })
      try {
        expect(migrate(db, migrations)).toEqual([])
      } finally {
        closeDatabase(db)
      }
    })

    it('refuses to overwrite an existing installation, and names what it would destroy', async () => {
      await seedAnEvening()
      await backup()

      await expect(restore()).rejects.toThrow(BackupError)
      await expect(restore()).rejects.toThrow(/Refusing to overwrite an existing installation/)
      await expect(restore()).rejects.toThrow(/--force/)
    })

    it('refuses when only the media root is occupied', async () => {
      const db = openLive()
      insertOwner(db)
      closeDatabase(db)
      await backup()
      await rm(databasePath, { force: true })
      await writeAllVariants(EVENT, hashOf('still-here'), 'still-here')

      await expect(restore()).rejects.toThrow(/Refusing to overwrite/)
    })

    it('overwrites when --force is given', async () => {
      await seedAnEvening()
      await backup()

      // The installation drifts on: another photo row, another file.
      const db = openDatabase({ path: databasePath })
      insertPhoto(db, { id: 'photo-2', guestId: 'guest-1', contentHash: hashOf('later') })
      closeDatabase(db)
      await writeAllVariants(EVENT, hashOf('later'), 'later')

      const result = await restore({ force: true })

      expect(result.mediaFilesWritten).toBe(3)
      const back = openDatabase({ path: databasePath, readonly: true })
      try {
        // Back to the moment of the backup, not a merge of the two.
        expect(back.prepare('SELECT COUNT(*) AS n FROM photos').get()).toEqual({ n: 1 })
      } finally {
        closeDatabase(back)
      }
      const strayDirectory = join(mediaRoot, EVENT, 'original', hashOf('later').slice(0, 2))
      expect(await exists(join(strayDirectory, `${hashOf('later')}.jpg`))).toBe(false)
    })

    it('removes a stale write-ahead log before it opens the database it restored', async () => {
      // A `-wal` belongs to the database that was just replaced, and SQLite replays a
      // structurally valid one into whatever `.sqlite` it finds beside it. So the
      // moment that matters is *before* the restored database is first opened, not
      // after: closing a connection checkpoints and removes the journal files anyway,
      // so an assertion taken at the end of the restore passes whether or not this
      // command ever deleted anything.
      await seedAnEvening()
      await backup()
      await writeFile(`${databasePath}-wal`, 'stale')
      await writeFile(`${databasePath}-shm`, 'stale')

      let journalAtFirstOpen: readonly boolean[] | null = null
      await restoreBackup({
        archive,
        databasePath,
        mediaRoot,
        force: true,
        migrations,
        onProgress: (line) => {
          if (!line.startsWith('Checking the restored database')) return
          journalAtFirstOpen = [
            existsSync(`${databasePath}-wal`),
            existsSync(`${databasePath}-shm`),
          ]
        },
      })

      expect(journalAtFirstOpen).toEqual([false, false])
    })

    it('refuses a damaged archive and leaves the installation untouched', async () => {
      // The unrecoverable sequence is deleting a good media root and only then
      // discovering the replacement is short. Verification happens first for this.
      const { contentHash } = await seedAnEvening()
      await backup()
      await rm(
        join(archive, MEDIA_DIR, EVENT, 'display', contentHash.slice(0, 2), `${contentHash}.jpg`),
      )

      await expect(restore({ force: true })).rejects.toThrow(/damaged archive/)

      const db = openDatabase({ path: databasePath, readonly: true })
      try {
        expect(db.prepare('SELECT COUNT(*) AS n FROM photos').get()).toEqual({ n: 1 })
      } finally {
        closeDatabase(db)
      }
      for (const variant of VARIANTS) {
        expect(
          await exists(
            join(mediaRoot, EVENT, variant, contentHash.slice(0, 2), `${contentHash}.jpg`),
          ),
        ).toBe(true)
      }
    })

    it('refuses an archive this build would not boot, before touching anything', async () => {
      await seedAnEvening()
      await backup()

      await expect(
        restoreBackup({
          archive,
          databasePath,
          mediaRoot,
          force: true,
          migrations: [],
        }),
      ).rejects.toThrow(/newer EventSlide/)

      expect(await exists(databasePath)).toBe(true)
    })

    it('applies the migrations an older archive still needs', async () => {
      await seedAnEvening()
      await backup()
      await rm(databasePath, { force: true })
      await rm(mediaRoot, { recursive: true, force: true })

      const withANewOne: readonly Migration[] = [
        ...migrations,
        {
          id: 999,
          name: 'add_a_later_column',
          sql: 'ALTER TABLE events ADD COLUMN a_later_column TEXT',
        },
      ]
      const result = await restoreBackup({
        archive,
        databasePath,
        mediaRoot,
        force: false,
        migrations: withANewOne,
      })

      expect(result.migrationsApplied).toEqual([999])
    })

    it('says so when the restored database will not come up under this build', async () => {
      // The ledger is fine and the archive is intact — this build's own newest
      // migration is what fails. The operator hears it from the restore command
      // instead of from a server that exits 78 with a room waiting for the wall.
      await seedAnEvening()
      await backup()
      await rm(databasePath, { force: true })
      await rm(mediaRoot, { recursive: true, force: true })

      const withABrokenOne: readonly Migration[] = [
        ...migrations,
        { id: 999, name: 'a_migration_that_fails', sql: 'CREATE TABLE nope (' },
      ]

      await expect(
        restoreBackup({
          archive,
          databasePath,
          mediaRoot,
          force: false,
          migrations: withABrokenOne,
        }),
      ).rejects.toThrow(/will not start with this build/)
    })

    it('round-trips an archive twice, so a restore can be rehearsed', async () => {
      const { contentHash } = await seedAnEvening()
      await backup()
      await rm(databasePath, { force: true })
      await rm(mediaRoot, { recursive: true, force: true })

      await restore()
      // The restored pair must itself be backup-able, or a rehearsal costs the archive.
      const second = join(root, 'archive-2')
      const { manifest } = await backup({ destination: second })

      expect(manifest.counts.photos).toBe(1)
      expect(manifest.counts.mediaFiles).toBe(3)
      expect(manifest.missingMedia).toEqual([])
      expect((await verifyBackup(second, { deep: true, migrations })).ok).toBe(true)
      expect(contentHash).toHaveLength(64)
    })

    /**
     * The window where an interrupted restore leaves neither the old data nor complete
     * new data. It is bounded by design and stays that way — the archive is verified in
     * full before anything is destroyed — so what is under test is the message, which is
     * the whole of the mitigation.
     *
     * `onProgress` is the seam. Its last line lands immediately before the media loop,
     * which makes "the archive went away mid-copy" deterministic rather than a race.
     */
    const BEFORE_THE_MEDIA_LOOP = 'media file(s) to'

    const restoreWhileTheArchiveIsDisturbed = async (disturb: () => void): Promise<string> => {
      const failure = await restoreBackup({
        archive,
        databasePath,
        mediaRoot,
        force: true,
        migrations,
        onProgress: (line) => {
          if (line.includes(BEFORE_THE_MEDIA_LOOP)) disturb()
        },
      }).then(
        () => null,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      )
      expect(failure).not.toBeNull()
      return failure ?? ''
    }

    it('names the archive and says a re-run finishes the job when the copy is cut short', async () => {
      const { contentHash } = await seedAnEvening()
      await backup()

      // The USB stick is unplugged between the verification and the copy.
      const message = await restoreWhileTheArchiveIsDisturbed(() => {
        rmSync(join(archive, MEDIA_DIR), { recursive: true, force: true })
      })

      expect(message).toContain(archive)
      expect(message).toContain('incomplete')
      expect(message).toMatch(/0 of 3 file\(s\)/)
      // The three things an operator reading this at 2am needs: that nothing is lost,
      // that the same command finishes it — with --force, the target no longer being
      // empty — and that this holds *once the cause is fixed*. Saying "incomplete"
      // without the first two sends someone looking for a recovery procedure that does
      // not exist; saying them without the third promises that a re-run always works,
      // which is true of a disconnected drive and false of a permission they do not have.
      expect(message).toMatch(/re-run the same restore/i)
      expect(message).toMatch(/once the cause is fixed/i)
      expect(message).toContain('--force')
      // The window is real, and the message is honest about it rather than reassuring:
      // the photo that was in the media root a moment ago is already gone, and what is
      // at its path now is the empty stub of a copy that was cut off.
      const displayed = join(
        mediaRoot,
        EVENT,
        'display',
        contentHash.slice(0, 2),
        `${contentHash}.jpg`,
      )
      expect(await readFile(displayed, 'utf8').catch(() => '')).toBe('')
    })

    it('says the same when a file changes under it after the deep check passed', async () => {
      const { contentHash } = await seedAnEvening()
      await backup()
      const thumb = join(
        archive,
        MEDIA_DIR,
        EVENT,
        'thumb',
        contentHash.slice(0, 2),
        `${contentHash}.jpg`,
      )

      const message = await restoreWhileTheArchiveIsDisturbed(() => {
        // Same length, different bytes: the corruption a size check cannot see, landing
        // after the deep verification that would have caught it.
        writeFileSync(thumb, 'x'.repeat(readFileSync(thumb).length))
      })

      expect(message).toContain('changed while it was being copied')
      expect(message).toContain('incomplete')
      // `thumb` sorts after `display` and `original`, so two files are already in place.
      expect(message).toMatch(/2 of 3 file\(s\)/)
    })
  })

  // ------------------------------------------------------------ hostile input --

  /**
   * An archive is the one artefact of this product that travels: USB stick, NAS, object
   * storage, a handover between the host and the client. `restore` exists to read a
   * file that came from somewhere else, which makes the manifest untrusted input — and
   * `entry.path` is the only string in it that becomes a *location* on the restoring
   * machine.
   *
   * Same family as the hostile payloads in `tests/e2e/fixtures/media.ts` — the pixel
   * bomb, the SVG renamed `.jpg`, the disguised script — one layer down.
   */
  describe('a hostile manifest', () => {
    const PAYLOAD = 'console.log("owned")'
    const THE_REAL_THING = 'the compiled server'

    /** `digestOfEntries`, recomputed the way an attacker would: the checksums are unkeyed. */
    const digestOf = (entries: readonly ManifestEntry[]): string => {
      const hash = createHash('sha256')
      for (const line of entries.map((e) => `${e.path}|${e.bytes}|${e.sha256}`).sort()) {
        hash.update(`${line}\n`)
      }
      return hash.digest('hex')
    }

    /**
     * Writes a manifest carrying one extra media entry, re-sealed so that every
     * self-check in the archive agrees with it.
     *
     * That is the half that made this serious: the integrity machinery cooperates.
     * Anyone who can edit an archive can recompute an unkeyed checksum, so a hostile
     * manifest caught by the entry digest would have proved nothing about the path rule.
     */
    const sealHostileEntry = async (pristine: BackupManifest, path: string): Promise<void> => {
      const entries: ManifestEntry[] = [
        ...pristine.media.entries,
        { path, bytes: Buffer.byteLength(PAYLOAD), sha256: hashOf(PAYLOAD) },
      ]
      await writeFile(
        join(archive, MANIFEST_FILE),
        JSON.stringify(
          {
            ...pristine,
            counts: { ...pristine.counts, mediaFiles: entries.length },
            media: { ...pristine.media, entries, entriesDigest: digestOf(entries) },
          },
          null,
          2,
        ),
        'utf8',
      )
    }

    it('cannot make the restore write outside the media root', async () => {
      await seedAnEvening()
      await backup()
      const pristine = await readManifest(archive)

      // The victim: the compiled server, one directory up from the media root.
      const victim = join(root, 'app', 'index.js')
      await mkdir(join(root, 'app'), { recursive: true })
      await writeFile(victim, THE_REAL_THING)

      // The payload travels inside the archive, at the place `<archive>/media/../app`
      // resolves to — which is why verification used to find it, check its size and its
      // sha256, and pronounce the archive sound.
      await mkdir(join(archive, 'app'), { recursive: true })
      await writeFile(join(archive, 'app', 'index.js'), PAYLOAD)
      await sealHostileEntry(pristine, '../app/index.js')

      await expect(verify()).rejects.toThrow(/must stay inside the archive/)
      await expect(restore({ force: true })).rejects.toThrow(/must stay inside the archive/)

      expect(await readFile(victim, 'utf8')).toBe(THE_REAL_THING)
    })

    it('refuses every shape of path this tool would never have written', async () => {
      await seedAnEvening()
      await backup()
      const pristine = await readManifest(archive)

      const hostile: readonly (readonly [string, string])[] = [
        ['a parent segment', '../outside.jpg'],
        ['a parent segment in the middle', 'an-event/../../outside.jpg'],
        ['an absolute POSIX path', '/etc/cron.d/eventslide'],
        ['a Windows drive', 'C:/Windows/System32/drivers/etc/hosts'],
        ['a drive-relative path, which resolves per drive', 'C:outside.jpg'],
        ['a UNC share', '//attacker/share/outside.jpg'],
        ['a backslash, which is the separator on Windows', 'an-event\\..\\..\\outside.jpg'],
        ['an NTFS alternate data stream', 'an-event/thumb/aa/photo.jpg:evil'],
        ['an empty segment', 'an-event//outside.jpg'],
        ['a bare dot segment', 'an-event/./outside.jpg'],
        ['a trailing separator', 'an-event/thumb/'],
        // A `\0` written as an escape would be a literal control byte in this file, so
        // it is built from its code point. Without the rule, Node throws `must be a
        // string without null bytes` from inside `fs` and a hostile manifest becomes a
        // stack trace instead of one sentence.
        ['a control character', `an-event/thumb/aa/photo${String.fromCodePoint(0)}.jpg`],
      ]

      for (const [what, path] of hostile) {
        await sealHostileEntry(pristine, path)
        const refusal = await readManifest(archive).then(
          () => null,
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        )
        expect(refusal, `${what}: ${JSON.stringify(path)} was accepted`).toContain(
          'must stay inside the archive',
        )
      }
    })

    it('refuses a database file that points outside the archive', async () => {
      await seedAnEvening()
      await backup()
      const pristine = await readManifest(archive)
      await writeFile(
        join(archive, MANIFEST_FILE),
        JSON.stringify({
          ...pristine,
          database: { ...pristine.database, file: '../../../etc/shadow' },
        }),
        'utf8',
      )

      // Not a write escape — the restore stages the database at a path of its own — but
      // it is the same string reaching `join` unchecked, and verification would have
      // opened whatever it found at the other end of it.
      await expect(verify()).rejects.toThrow(/must stay inside the archive/)
    })

    it('refuses at the write too, for a path that never reached the schema', async () => {
      // The second gate, unreachable through the first by construction: `restoreBackup`
      // only ever sees entries `readManifest` has parsed. It is asserted directly
      // because a gate that exists in case the other one is wrong cannot be reached by
      // being right, and because the next caller of this module is not obliged to parse.
      expect(() => resolveInside(mediaRoot, join('..', 'outside.jpg'))).toThrow(BackupError)
      expect(() => resolveInside(mediaRoot, join('..', 'outside.jpg'))).toThrow(/must stay inside/)
      // The reason the check compares against the root *plus a separator*: a sibling
      // whose name merely starts with the root's would otherwise read as inside it.
      expect(() => resolveInside(mediaRoot, join('..', 'media-old', 'x.jpg'))).toThrow(BackupError)
      // And the ordinary case still resolves to where the media store would put it.
      expect(resolveInside(mediaRoot, join(EVENT, 'thumb', 'aa', 'x.jpg'))).toBe(
        join(mediaRoot, EVENT, 'thumb', 'aa', 'x.jpg'),
      )
    })

    it.skipIf(process.platform === 'win32')(
      'leaves behind a media file whose name cannot be written as an archive path',
      async () => {
        // POSIX allows a backslash in a filename and this archive format cannot express
        // one, because its paths are `/`-separated. Skipped and named, the way a staging
        // file is: copying it would produce an archive whose manifest this build then
        // refuses to read, which is a backup that fails after writing every byte.
        // Windows cannot hold such a name at all, so there is nothing to test there.
        await seedAnEvening()
        await mkdir(join(mediaRoot, 'junk'), { recursive: true })
        await writeFile(join(mediaRoot, 'junk', 'a\\..\\..\\escape.jpg'), 'not ours')

        const { manifest } = await backup()

        expect(manifest.skipped.join('\n')).toContain('cannot be written as an archive path')
        expect(manifest.media.entries.map((entry) => entry.path)).toHaveLength(3)
        expect((await verify()).ok).toBe(true)
      },
    )
  })
})
