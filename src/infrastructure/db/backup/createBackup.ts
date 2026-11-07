import { mkdir, readdir, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  EVENT_LOGO,
  MEDIA_VARIANTS,
  STAGED_SOURCE,
  VENUE_GROUND,
} from '../../../application/ports/mediaStore'
import { mediaObjectPath } from '../../media/mediaLayout'
import { HOLDING_BYTES_SQL } from '../clipJobStatusSql'
import { closeDatabase, openDatabase, type Db } from '../connection'
import { BackupError } from './backupError'
import { isContainedPath, toPosix } from './paths'
import {
  ARCHIVE_FORMAT,
  DATABASE_FILE,
  MANIFEST_FILE,
  MEDIA_DIR,
  digestOfEntries,
  type BackupManifest,
  type LedgerRow,
  type ManifestEntry,
} from './manifest'
import { integrityCheck, looksLikeSqlite, messageOf, streamThroughSha256, walkFiles } from './files'

/** Taking a backup: the VACUUM snapshot, the media copy, and the manifest that ties them. */

/** True when `error` is the file at `path` not existing (and not, say, the destination folder). */
const isSourceMissing = (error: unknown, path: string): boolean => {
  const { code, path: failing } = error as { code?: string; path?: string }
  return code === 'ENOENT' && failing === path
}

const countRows = (db: Db, table: string): number => {
  // Table names are compile-time constants from this module, never input. An
  // un-grouped COUNT(*) always answers with exactly one row, so there is no absent
  // case to branch on.
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
  return row.n
}

interface PhotoRow {
  readonly id: string
  readonly eventId: string
  readonly contentHash: string
  /** `photo` or `clip`, which decides which renditions this row owns. */
  readonly mediaKind: string
  /** A clip's poster is a second file under a second digest; `null` on a photograph. */
  readonly posterHash: string | null
}

/**
 * A clip that is still in the queue: a staged source on the disk with no photos row.
 *
 * It has to be read, or every mid-event backup reports the whole contents of the queue
 * as unreferencedMediaFiles — which is the number an operator is told to investigate as
 * a leak. The bytes are also copied by the media walk either way, so omitting them would
 * be an archive that carries a file its own manifest calls unaccounted for.
 */
interface StagedClipRow {
  readonly eventId: string
  readonly sourceHash: string
}

/** An event whose settings name a host's own venue photograph (ADR 0010). */
interface VenuePhotoRow {
  readonly eventId: string
  readonly hash: string
}

/**
 * Every file one row owns, as the media store laid it down.
 *
 * A photograph has three renditions under one digest; a clip has an mp4 under its own
 * and a poster under a **second** one, because the store's invariant is that the name of
 * a file is the hash of that file. Walking `MEDIA_VARIANTS` alone would have reported
 * every clip in an album as three missing photo files while quietly not accounting for
 * the two real ones — and a backup that silently omits a kind of content is precisely
 * what the reconciliation below exists to make impossible.
 */
const expectedPathsOf = (
  photo: PhotoRow,
): readonly { readonly variant: string; readonly path: string }[] => {
  if (photo.mediaKind !== 'clip') {
    return MEDIA_VARIANTS.map((variant) => ({
      variant,
      path: mediaObjectPath(photo.eventId, photo.contentHash, variant),
    }))
  }
  // A clip row with no poster digest is a corrupt row; the repository refuses it on
  // read. Here the archive is the last chance to notice, so it falls back to the
  // video's digest and lets the missing-media list report what is not there.
  const poster = photo.posterHash ?? photo.contentHash
  return [
    { variant: 'video', path: mediaObjectPath(photo.eventId, photo.contentHash, 'video') },
    { variant: 'poster', path: mediaObjectPath(photo.eventId, poster, 'poster') },
  ]
}

/**
 * Everything read out of the snapshot, in one open/close.
 *
 * Opened **read-only**, which is load-bearing rather than tidy: a read-write open runs
 * `journal_mode = WAL` (see `applyPragmas`), and that rewrites a byte in the database
 * header. The file's sha256 would then differ from the one the manifest records, so
 * merely verifying an archive would invalidate it.
 */
const readSnapshot = (
  path: string,
): {
  integrityCheck: string
  migrations: LedgerRow[]
  counts: BackupManifest['counts']
  photos: PhotoRow[]
  stagedClips: StagedClipRow[]
  venuePhotos: VenuePhotoRow[]
  logos: VenuePhotoRow[]
} => {
  const db = openDatabase({ path, readonly: true })
  try {
    const verdict = integrityCheck(db)

    const migrationRows = db
      .prepare('SELECT id, name, checksum FROM schema_migrations ORDER BY id')
      .all() as LedgerRow[]

    const photos = db
      .prepare(
        `SELECT id, event_id AS eventId, content_hash AS contentHash,
                media_kind AS mediaKind, poster_hash AS posterHash
           FROM photos`,
      )
      .all() as PhotoRow[]

    // Only the statuses that still hold a source — a reservation included, whose bytes
    // may be landing as this runs. A `done` job's source is deleted the moment the
    // transcode succeeds, and naming it here would turn a correct archive into a
    // `missingMedia` entry for a clip that worked hours ago.
    //
    // A `failed` one is less tidy and deliberately so: `transcodeNextClip` deletes the
    // source when the clip's own content is at fault, but `recoverClipJobs` **keeps** it
    // when the box was, because that delete cannot be walked back. Those bytes are
    // therefore real and unnamed — copied by the media walk, reported in
    // `unreferencedMediaFiles`, and collected by `sweepOrphanedMedia` rather than here.
    const stagedClips = db
      .prepare(
        `SELECT event_id AS eventId, source_hash AS sourceHash
           FROM clip_jobs
          WHERE status IN (${HOLDING_BYTES_SQL})`,
      )
      .all() as StagedClipRow[]

    // A host's own venue photograph is named by an event's settings rather than by a `photos`
    // row (ADR 0010); without this it would be reported as an unreferenced file, the number an
    // operator is told means a leak.
    const venuePhotos = db
      .prepare(
        `SELECT id AS eventId, json_extract(settings, '$.venuePhoto') AS hash
           FROM events
          WHERE json_extract(settings, '$.venuePhoto') IS NOT NULL`,
      )
      .all() as VenuePhotoRow[]

    // A host's logo (spec 03) is named by settings too, and would otherwise be reported as unreferenced.
    const logos = db
      .prepare(
        `SELECT id AS eventId, json_extract(settings, '$.logo') AS hash
           FROM events
          WHERE json_extract(settings, '$.logo') IS NOT NULL`,
      )
      .all() as VenuePhotoRow[]

    return {
      integrityCheck: verdict,
      stagedClips,
      venuePhotos,
      logos,
      migrations: migrationRows,
      counts: {
        users: countRows(db, 'users'),
        events: countRows(db, 'events'),
        guests: countRows(db, 'guests'),
        photos: photos.length,
        reactions: countRows(db, 'reactions'),
        // Filled in once the media half has been walked.
        mediaFiles: 0,
      },
      photos,
    }
  } finally {
    closeDatabase(db)
  }
}

// ---------------------------------------------------------------------- backup --

export interface BackupOptions {
  readonly databasePath: string
  readonly mediaRoot: string
  /** Created by this call. Must not already exist with anything in it. */
  readonly destination: string
  /** Injected, so a test can assert the stamp and the module never reads the clock. */
  readonly now: Date
  readonly appVersion: string
  readonly onProgress?: (line: string) => void
  /**
   * Free bytes on the filesystem that will hold `path`, or `null` when that cannot be
   * read. Injected so a test can stand in a full disk; the default asks `statfs`.
   */
  readonly freeBytesAt?: (path: string) => Promise<number | null>
}

export interface BackupResult {
  readonly destination: string
  readonly manifest: BackupManifest
}

/** The archive does not exist yet, so the nearest ancestor that does is asked instead. */
const freeBytesOnFilesystemOf = async (path: string): Promise<number | null> => {
  let probe = resolve(path)
  for (;;) {
    try {
      const { bavail, bsize } = await statfs(probe)
      return bavail * bsize
    } catch {
      const parent = dirname(probe)
      if (parent === probe) return null
      probe = parent
    }
  }
}

/**
 * What the archive will take: the database with whatever its WAL still holds, since the
 * snapshot carries both, and every file under the media root. An estimate from above —
 * `VACUUM INTO` drops free pages, and staging files are left behind — which is the right
 * direction for the only question it answers.
 */
const bytesToArchive = async (database: string, mediaRoot: string): Promise<number> => {
  let total = 0
  for (const path of [database, `${database}-wal`]) {
    total += (await stat(path).catch(() => null))?.size ?? 0
  }
  for (const file of await walkFiles(mediaRoot, [])) {
    total += (await stat(file.absolute).catch(() => null))?.size ?? 0
  }
  return total
}

export const createBackup = async ({
  databasePath,
  mediaRoot,
  destination,
  now,
  appVersion,
  onProgress = () => {},
  freeBytesAt = freeBytesOnFilesystemOf,
}: BackupOptions): Promise<BackupResult> => {
  const sourceDatabase = resolve(databasePath)
  const sourceMedia = resolve(mediaRoot)
  const archive = resolve(destination)

  // A directory is the common miss — `--database` given the data root rather than the
  // file inside it — and it has to be caught here, or `looksLikeSqlite` reads it and
  // the operator gets `EISDIR` instead of a sentence.
  const sourceInfo = await stat(sourceDatabase).catch(() => null)
  if (sourceInfo === null || !sourceInfo.isFile()) {
    throw new BackupError(`There is no database file at ${sourceDatabase}`)
  }
  if (!(await looksLikeSqlite(sourceDatabase))) {
    throw new BackupError(
      `${sourceDatabase} is not a SQLite database: it does not start with the SQLite ` +
        `header. Check --database, or point it at the file the server is configured ` +
        `with (DATABASE_PATH).`,
    )
  }

  // A backup that overwrote a previous one would destroy the only other copy at the
  // moment the operator is trying to make a second.
  const occupants = await readdir(archive).catch(() => null)
  if (occupants !== null && occupants.length > 0) {
    throw new BackupError(
      `${archive} already exists and is not empty. Back up to a new directory rather ` +
        `than over the top of an older archive.`,
    )
  }

  // **Refused before a byte is written, when it cannot fit.** The image's default archive
  // lives on the data volume, which is also where every upload and every database write
  // goes. A backup that ran out of room part-way used to stop with ENOSPC and leave the
  // half it had written, so the volume stayed full and the wall stopped taking photos —
  // uploads and the host's approvals alike — until somebody thought to look in
  // /data/backups. Nothing here promises headroom afterwards; it promises not to be the
  // thing that fills the disk.
  const needed = await bytesToArchive(sourceDatabase, sourceMedia)
  const free = await freeBytesAt(archive)
  if (free !== null && free < needed) {
    throw new BackupError(
      `The archive would not fit: it needs about ${needed} bytes and the filesystem ` +
        `holding ${archive} has ${free} free. Nothing was written. Free some space, or ` +
        `pass --to a drive with room.`,
    )
  }

  await mkdir(archive, { recursive: true })
  try {
    return await writeArchive({ sourceDatabase, sourceMedia, archive, now, appVersion, onProgress })
  } catch (cause) {
    // Whatever failed, a partial archive is worth nothing and costs its size on a disk
    // that may be the server's. Only what this call wrote goes: the directory itself
    // survives if it was there before, because it may be a mount point the operator
    // made for exactly this.
    const existed = occupants !== null
    for (const name of await readdir(archive).catch(() => [])) {
      await rm(join(archive, name), { recursive: true, force: true })
    }
    if (!existed) await rm(archive, { recursive: true, force: true })
    throw cause
  }
}

interface ArchiveInput {
  readonly sourceDatabase: string
  readonly sourceMedia: string
  readonly archive: string
  readonly now: Date
  readonly appVersion: string
  readonly onProgress: (line: string) => void
}

/** The writing half of `createBackup`, once every refusal has had its chance. */
const writeArchive = async ({
  sourceDatabase,
  sourceMedia,
  archive,
  now,
  appVersion,
  onProgress,
}: ArchiveInput): Promise<BackupResult> => {
  // ------------------------------------------------------- the database half --
  // First, deliberately. See the class docstring: an upload that lands after this
  // point is simply not in this backup, which is recoverable; the other ordering
  // produces rows pointing at bytes nobody copied, which is not.
  const snapshotPath = join(archive, DATABASE_FILE)
  onProgress(`Snapshotting the database with VACUUM INTO -> ${DATABASE_FILE}`)

  const live = openDatabase({ path: sourceDatabase })
  try {
    // The one correct way to copy an open SQLite database. `VACUUM INTO` fails if the
    // target exists, which is a guard worth keeping rather than working around.
    live.prepare('VACUUM INTO ?').run(snapshotPath)
  } catch (cause) {
    throw new BackupError(
      `VACUUM INTO failed, so no consistent snapshot could be taken: ` + `${messageOf(cause)}`,
    )
  } finally {
    closeDatabase(live)
  }

  const snapshot = readSnapshot(snapshotPath)
  if (snapshot.integrityCheck !== 'ok') {
    throw new BackupError(
      `The snapshot failed PRAGMA integrity_check (${snapshot.integrityCheck}). The ` +
        `source database at ${sourceDatabase} is damaged; do not overwrite your last ` +
        `good backup with this one.`,
    )
  }
  const database = await streamThroughSha256(snapshotPath, null)
  onProgress(
    `  ${snapshot.counts.events} event(s), ${snapshot.counts.photos} photo row(s), ` +
      `integrity_check ok`,
  )

  // ---------------------------------------------------------- the media half --
  onProgress(`Copying the media root ${sourceMedia}`)
  const skipped: string[] = []
  const files = await walkFiles(sourceMedia, skipped)
  onProgress(`  ${files.length} media file(s) to copy`)

  const entries: ManifestEntry[] = []
  let mediaBytes = 0
  for (const file of files) {
    const posix = toPosix(file.relative)
    if (!isContainedPath(posix)) {
      // A name the manifest format cannot carry: a backslash or a colon in a filename,
      // which POSIX allows and this archive's `/`-separated paths cannot express. Named
      // and left behind, like a staging file, rather than copied — copying it would
      // produce an archive that this build's own reader then refuses, and a backup that
      // reports failure after writing every byte is the worst of both outcomes.
      skipped.push(`${posix}: the name cannot be written as an archive path`)
      continue
    }
    const target = join(archive, MEDIA_DIR, file.relative)
    let copied
    try {
      copied = await streamThroughSha256(file.absolute, target)
    } catch (error) {
      if (!isSourceMissing(error, file.absolute)) throw error
      // **A photo the host deleted while the backup ran** (retention, an orphan sweep: the
      // server stays live, which is the documented use). The database half was snapshotted
      // first, so its row is either gone from the snapshot or reported below as
      // `missingMedia`; neither is a reason to throw away every byte already copied. Only
      // the source going missing is forgiven: any other error stays fatal.
      await rm(target, { force: true })
      skipped.push(`${posix}: vanished while the backup ran`)
      continue
    }
    entries.push({ path: posix, bytes: copied.bytes, sha256: copied.sha256 })
    mediaBytes += copied.bytes
  }

  // --------------------------------------------- do the two halves agree? --
  const captured = new Set(entries.map((entry) => entry.path))
  const expected = new Set<string>()
  const missingMedia: BackupManifest['missingMedia'] = []

  for (const photo of snapshot.photos) {
    for (const { variant, path } of expectedPathsOf(photo)) {
      expected.add(path)
      if (!captured.has(path)) {
        missingMedia.push({
          photoId: photo.id,
          eventId: photo.eventId,
          contentHash: photo.contentHash,
          variant,
        })
      }
    }
  }

  // The queue's half. A staged source is named by a `clip_jobs` row rather than by a
  // `photos` one, so without this every clip waiting when the backup ran was reported as
  // an unreferenced file — the number an operator is told means a leak.
  //
  // Deliberately **not** added to `missingMedia`: the window between a job being marked
  // `done` and its source being deleted is a few statements wide, and a backup that
  // happens to open inside it would otherwise report a fault in an archive that has
  // everything anybody will ever need.
  for (const clip of snapshot.stagedClips) {
    expected.add(mediaObjectPath(clip.eventId, clip.sourceHash, STAGED_SOURCE))
  }

  // The host's own venue photographs, named by an event's settings (ADR 0010).
  for (const venue of snapshot.venuePhotos) {
    expected.add(mediaObjectPath(venue.eventId, venue.hash, VENUE_GROUND))
  }

  for (const logo of snapshot.logos) {
    expected.add(mediaObjectPath(logo.eventId, logo.hash, EVENT_LOGO))
  }

  const unreferencedMediaFiles = entries.filter((entry) => !expected.has(entry.path)).length

  const manifest: BackupManifest = {
    format: ARCHIVE_FORMAT,
    createdAt: now.toISOString(),
    appVersion,
    source: { databasePath: sourceDatabase, mediaRoot: sourceMedia },
    database: {
      file: DATABASE_FILE,
      bytes: database.bytes,
      sha256: database.sha256,
      integrityCheck: snapshot.integrityCheck,
    },
    migrations: snapshot.migrations,
    counts: { ...snapshot.counts, mediaFiles: entries.length },
    media: { bytes: mediaBytes, entries, entriesDigest: digestOfEntries(entries) },
    missingMedia,
    unreferencedMediaFiles,
    skipped,
  }

  await writeFile(join(archive, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  onProgress(`  ${entries.length} media file(s), ${mediaBytes} byte(s)`)

  return { destination: archive, manifest }
}
