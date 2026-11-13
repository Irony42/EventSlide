import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { closeDatabase, openDatabase } from '../connection'
import { migrate, MigrationError, type Migration } from '../migrator'
import { fromPosix, resolveInside } from './paths'
import { assertArchiveApart } from './containment'
import { BackupError } from './backupError'
import { MEDIA_DIR, type BackupManifest, type ManifestEntry } from './manifest'
import { verifyBackup } from './verifyBackup'
import { exists, messageOf, streamThroughSha256, walkFiles } from './files'

/** Putting an archive back: inspecting the target, then copying the verified archive over it. */

export interface RestoreTarget {
  readonly databasePath: string
  readonly mediaRoot: string
  readonly databaseBytes: number | null
  readonly mediaFiles: number
  readonly mediaBytes: number
  /** A `-wal` or `-shm` beside the database: a server is probably still running. */
  readonly liveJournal: boolean
  readonly occupied: boolean
}

/**
 * What restoring would destroy. Read-only; the CLI prints this before it acts.
 *
 * Also the one "is it safe to proceed" step, so it refuses an archive that overlaps the
 * target (inside the media root, around it, or around the database) whatever `--force`
 * says: the restore would delete the archive it is reading from.
 */
export const inspectRestoreTarget = async (
  archive: string,
  databasePath: string,
  mediaRoot: string,
): Promise<RestoreTarget> => {
  await assertArchiveApart({ archive, databasePath, mediaRoot, operation: 'restore' })
  const database = resolve(databasePath)
  const media = resolve(mediaRoot)

  const databaseStat = await stat(database).catch(() => null)
  const liveJournal = (await exists(`${database}-wal`)) || (await exists(`${database}-shm`))

  const skipped: string[] = []
  const files = await walkFiles(media, skipped)
  let mediaBytes = 0
  for (const file of files) {
    const info = await stat(file.absolute).catch(() => null)
    if (info !== null) mediaBytes += info.size
  }

  return {
    databasePath: database,
    mediaRoot: media,
    databaseBytes: databaseStat?.size ?? null,
    mediaFiles: files.length,
    mediaBytes,
    liveJournal,
    occupied: databaseStat !== null || files.length > 0,
  }
}

export interface RestoreOptions {
  readonly archive: string
  readonly databasePath: string
  readonly mediaRoot: string
  /** Required to write over anything at all. Nothing else unlocks it. */
  readonly force: boolean
  readonly migrations: readonly Migration[]
  readonly onProgress?: (line: string) => void
}

export interface RestoreResult {
  readonly manifest: BackupManifest
  readonly target: RestoreTarget
  readonly mediaFilesWritten: number
  /** Migrations the restored database still needed. Empty is the ordinary case. */
  readonly migrationsApplied: readonly number[]
}

/**
 * The one window in this product where an interrupted operation leaves an operator with
 * neither the data from before nor complete data from after, said out loud.
 *
 * The window is deliberate and stays: the media root is replaced in place because
 * copying several gigabytes twice to get atomicity is not a price a self-hosted box can
 * pay, and the archive has been proven complete before anything is destroyed. What was
 * missing was not a smaller window but a legible one. "The restore is incomplete" on
 * its own sends somebody looking for a recovery procedure that does not exist; the
 * facts that matter are that **nothing is lost while the archive is readable** and that
 * **the same command finishes the job** — true, because a restore verifies the archive
 * again and rewrites both halves from scratch every time, and because the media copy is
 * therefore idempotent.
 *
 * `--force` is named because it is now required and was not before: the target holds a
 * partial installation, so the refusal in `restoreBackup` would otherwise stop the
 * re-run that fixes it.
 */
const incompleteRestore = (
  archiveRoot: string,
  target: RestoreTarget,
  entry: ManifestEntry,
  reason: string,
  written: number,
  total: number,
): BackupError =>
  new BackupError(
    `media/${entry.path} could not be restored: ${reason}.\n` +
      `  archive   ${archiveRoot}\n` +
      `  database  ${target.databasePath}  (already replaced from the archive)\n` +
      `  media     ${target.mediaRoot}  (${written} of ${total} file(s) written)\n` +
      `The target is now incomplete: the restored database, part of the restored media, ` +
      `and nothing of what was there before.\n` +
      `Nothing is lost while that archive is readable. Once the cause is fixed — space, ` +
      `permissions, a disconnected drive — re-run the same restore with --force, which ` +
      `the target now needs because it is no longer empty: the copy is idempotent, so a ` +
      `second run rewrites both halves and costs only time. A failure that repeats is a ` +
      `property of the target, not of the archive.`,
  )

/**
 * Writes an archive over a database and a media root.
 *
 * Destructive by definition, so the order is: verify everything, refuse if the target
 * holds anything and `force` was not given, and only then write. The archive is
 * checked in full first because the one unrecoverable sequence is deleting a good
 * media root and *then* discovering the replacement is short of four hundred files.
 *
 * The database goes in via a temporary sibling and a rename, so a restore interrupted
 * mid-copy leaves the previous database where it was rather than half of a new one.
 * The media root is replaced in place: copying several gigabytes twice to get the same
 * property is not a trade a self-hosted box can pay, and by this point the archive has
 * already been proven complete.
 */
export const restoreBackup = async ({
  archive,
  databasePath,
  mediaRoot,
  force,
  migrations,
  onProgress = () => {},
}: RestoreOptions): Promise<RestoreResult> => {
  const root = resolve(archive)

  // The refusal comes first because it is free, and checksumming forty gigabytes
  // before telling an operator that they needed `--force` is forty gigabytes of
  // waiting for an answer that was known at the start. The safety property is
  // unaffected: the archive is still proven before anything is destroyed, below.
  const target = await inspectRestoreTarget(root, databasePath, mediaRoot)
  if (target.occupied && !force) {
    throw new BackupError(
      `Refusing to overwrite an existing installation.\n` +
        `  database  ${target.databasePath}` +
        `${target.databaseBytes === null ? '  (absent)' : `  (${target.databaseBytes} bytes)`}\n` +
        `  media     ${target.mediaRoot}  (${target.mediaFiles} file(s), ${target.mediaBytes} bytes)\n` +
        `Restore into an empty location, or pass --force to destroy the above.`,
    )
  }

  onProgress(`Verifying ${root} before writing anything`)
  const report = await verifyBackup(root, { deep: true, migrations, onProgress })
  if (!report.ok || report.manifest === null) {
    throw new BackupError(
      `Refusing to restore from a damaged archive:\n` +
        report.problems.map((problem) => `  - ${problem}`).join('\n'),
    )
  }
  const manifest = report.manifest

  // Every media path is turned into a location here, before a single byte is written,
  // so that the second containment gate refuses a manifest while the installation is
  // still whole. `entrySchema` has already refused anything that could fail this; a
  // belt that only fastens halfway through the operation is not a belt. See
  // `resolveInside`.
  const copies = manifest.media.entries.map((entry) => {
    const relative = fromPosix(entry.path)
    return {
      entry,
      from: resolveInside(join(root, MEDIA_DIR), relative),
      to: resolveInside(target.mediaRoot, relative),
    }
  })

  // ------------------------------------------------------------- database --
  const staged = `${target.databasePath}.restoring`
  await rm(staged, { force: true })
  onProgress(`Restoring the database to ${target.databasePath}`)
  const copied = await streamThroughSha256(join(root, manifest.database.file), staged)
  if (copied.sha256 !== manifest.database.sha256) {
    await rm(staged, { force: true })
    throw new BackupError(
      `The database changed while it was being copied out of the archive. Nothing was ` +
        `overwritten.`,
    )
  }

  // The journal files belong to the database being replaced; leaving them beside a
  // different database file is how a "successful" restore opens as corrupt.
  await rm(`${target.databasePath}-wal`, { force: true })
  await rm(`${target.databasePath}-shm`, { force: true })
  await rm(target.databasePath, { force: true })
  await rename(staged, target.databasePath)

  // -------------------------------------------------------------- media --
  onProgress(`Restoring ${manifest.media.entries.length} media file(s) to ${target.mediaRoot}`)
  // **Emptied, not removed and recreated.** The media root is the operator's directory
  // and this command owns only what is inside it. It used to be `rm -r` followed by
  // `mkdir`, which put a new directory in its place with the process umask's mode — so
  // a restore inside the image turned the `0700` media root the Dockerfile creates, and
  // docs/SECURITY.md §11 asks for, into `0755`. And a media root that is a mount point
  // cannot be removed at all: the `rmdir` fails with EBUSY after every file under it is
  // already gone. Clearing its entries keeps the directory's mode, its owner and
  // whatever is mounted there exactly as the operator arranged them. What is written
  // inside it belongs to whoever runs the restore, which is why the documented one runs
  // as the image's own user.
  await mkdir(target.mediaRoot, { recursive: true })
  for (const name of await readdir(target.mediaRoot)) {
    await rm(join(target.mediaRoot, name), { recursive: true, force: true })
  }

  let written = 0
  for (const { entry, from, to } of copies) {
    let failure: string | null = null
    try {
      const restored = await streamThroughSha256(from, to)
      if (restored.sha256 !== entry.sha256) {
        failure = 'it changed while it was being copied out of the archive'
      }
    } catch (cause) {
      // A read that failed, a disk that filled, an archive that was unplugged. Every
      // one of them lands here rather than propagating raw, because by this point the
      // operator needs the state of their installation explained, not an errno.
      failure = messageOf(cause)
    }
    if (failure !== null) {
      throw incompleteRestore(root, target, entry, failure, written, copies.length)
    }
    written += 1
  }

  // ------------------------------------------------------ prove it boots --
  // The same call `src/main/container.ts` makes at startup, run here so a ledger the
  // server would reject is discovered by the person doing the restore rather than by a
  // host whose wall will not come up.
  onProgress('Checking the restored database against this build')
  const db = openDatabase({ path: target.databasePath })
  let migrationsApplied: readonly number[]
  try {
    migrationsApplied = migrate(db, migrations)
  } catch (cause) {
    throw new BackupError(
      cause instanceof MigrationError
        ? `The restored database will not start with this build: ${cause.message}`
        : `The restored database could not be checked: ` + `${messageOf(cause)}`,
    )
  } finally {
    closeDatabase(db)
  }

  return { manifest, target, mediaFilesWritten: written, migrationsApplied }
}
