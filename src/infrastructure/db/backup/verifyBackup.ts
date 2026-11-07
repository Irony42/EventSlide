import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { closeDatabase, openDatabase } from '../connection'
import { checksumOf, type Migration } from '../migrator'
import { fromPosix } from './paths'
import {
  MEDIA_DIR,
  digestOfEntries,
  readManifest,
  type BackupManifest,
  type LedgerRow,
} from './manifest'
import { integrityCheck, messageOf, streamThroughSha256 } from './files'

/** Proving an archive intact before anyone relies on it. */

export interface VerifyOptions {
  /**
   * Recompute every checksum. Off, this checks structure, sizes and the entry digest
   * only — enough to catch a truncated or half-copied archive in seconds, not enough
   * to catch a file whose bytes rotted while its length stayed the same.
   */
  readonly deep: boolean
  /** The migrations this build knows, so the archive can be checked against them. */
  readonly migrations: readonly Migration[]
  readonly onProgress?: (line: string) => void
}

export interface VerifyReport {
  readonly ok: boolean
  readonly manifest: BackupManifest | null
  /** Reasons this archive must not be relied on. */
  readonly problems: readonly string[]
  /** True of the archive, worth knowing, not a reason to refuse it. */
  readonly warnings: readonly string[]
  readonly checkedFiles: number
  readonly deep: boolean
}

/**
 * Proves an archive is intact before anyone relies on it.
 *
 * What this catches: a missing or unreadable manifest, a manifest this build cannot
 * read, a database file that is absent, the wrong length, or whose bytes have changed;
 * a database that fails `PRAGMA integrity_check`; any media file that is absent or the
 * wrong length, and (deep) any whose bytes have changed; an entry list that has been
 * truncated; and an archive whose migration ledger this build does not recognise,
 * which is the case where a restore would boot into `MigrationError` rather than a
 * working wall.
 *
 * What it does not catch, stated plainly because a backup check that oversells itself
 * is worse than none:
 *
 * - **Tampering with contents.** The checksums are unkeyed. Anyone who can edit the
 *   archive can recompute them, entry digest included, so this detects damage and not
 *   an adversary. The exception is the one that mattered: where a manifest *points*.
 *   `entry.path` and `database.file` are constrained at the parse (`isContainedPath`),
 *   so a manifest can no longer name a location outside the archive — a restore that
 *   overwrites the compiled server was the difference between a useless backup and code
 *   execution. Substituting the bytes of any file *inside* the archive remains entirely
 *   possible, and the database is one of those files.
 * - **A faithful copy of already-wrong data.** `integrity_check` proves the B-trees
 *   are sound, not that a photo row points at the caption a guest actually wrote.
 * - **Rot after the check.** A verified archive is a statement about one moment. Files
 *   on a disk that is failing will pass today and fail next month; re-verify before
 *   relying on it, which is why `restore` verifies rather than trusting an old result.
 * - **Anything outside these two paths.** `.env` is not in here. Restoring photos with
 *   a different `GUEST_TOKEN_SECRET` invalidates every outstanding guest token, and a
 *   different `SESSION_SECRET` logs every host out. Back the secrets up separately.
 */
export const verifyBackup = async (
  archive: string,
  { deep, migrations, onProgress = () => {} }: VerifyOptions,
): Promise<VerifyReport> => {
  const root = resolve(archive)
  const problems: string[] = []
  const warnings: string[] = []
  let checkedFiles = 0
  let ledger: LedgerRow[] | null = null

  const manifest = await readManifest(root)

  // -------------------------------------------------------------- database --
  const databasePath = join(root, manifest.database.file)
  const databaseStat = await stat(databasePath).catch(() => null)
  if (databaseStat === null) {
    problems.push(`${manifest.database.file} is missing from the archive`)
  } else if (databaseStat.size !== manifest.database.bytes) {
    problems.push(
      `${manifest.database.file} is ${databaseStat.size} bytes, the manifest says ` +
        `${manifest.database.bytes}`,
    )
  } else {
    checkedFiles += 1
    if (deep) {
      onProgress(`Checksumming ${manifest.database.file}`)
      const actual = await streamThroughSha256(databasePath, null)
      if (actual.sha256 !== manifest.database.sha256) {
        problems.push(
          `${manifest.database.file} does not match its recorded checksum: the database ` +
            `in this archive is not the one that was backed up`,
        )
      }
    }
    // Cheap, and the two most valuable things to know about a backup: that the pages
    // are sound, and that the server will agree to start against it.
    try {
      const db = openDatabase({ path: databasePath, readonly: true })
      try {
        const verdict = integrityCheck(db)
        if (verdict !== 'ok') {
          problems.push(`the archived database fails integrity_check: ${verdict}`)
        }
        ledger = db
          .prepare('SELECT id, name, checksum FROM schema_migrations ORDER BY id')
          .all() as LedgerRow[]
      } finally {
        closeDatabase(db)
      }
    } catch (cause) {
      problems.push(`the archived database could not be opened: ` + `${messageOf(cause)}`)
    }
  }

  // ------------------------------------------------------- migration ledger --
  // Read out of the archived database rather than trusted from the manifest, because
  // the ledger is what `src/main/container.ts` will check at boot. An archive whose
  // ledger this build rejects restores into a wall that never comes up, and the place
  // to discover that is here, before anything has been overwritten.
  if (ledger !== null) {
    const known = new Map(migrations.map((migration) => [migration.id, migration]))
    for (const row of ledger) {
      const migration = known.get(row.id)
      if (migration === undefined) {
        problems.push(
          `the archive has migration ${row.id} (${row.name}) applied, which this build does ` +
            `not know. It was taken from a newer EventSlide; restoring it here would refuse ` +
            `to start. Restore it with the version that produced it.`,
        )
        continue
      }
      if (checksumOf(migration) !== row.checksum) {
        problems.push(
          `migration ${row.id} (${row.name}) in the archive has a different checksum from ` +
            `the one this build carries. The server refuses to start on that, so this ` +
            `archive and this build are not a pair.`,
        )
      }
    }

    const pending = migrations.filter(
      (migration) => !ledger?.some((row) => row.id === migration.id),
    )
    if (pending.length > 0) {
      warnings.push(
        `the archive predates this build: ${pending.length} migration(s) will be applied on ` +
          `the first boot after restoring (${pending.map((m) => m.name).join(', ')})`,
      )
    }

    if (ledger.length !== manifest.migrations.length) {
      problems.push(
        `the manifest records ${manifest.migrations.length} applied migration(s) but the ` +
          `archived database has ${ledger.length}`,
      )
    }
  }

  // ----------------------------------------------------------------- media --
  if (digestOfEntries(manifest.media.entries) !== manifest.media.entriesDigest) {
    problems.push(
      `the manifest's media entry list does not match its own digest: the manifest is ` +
        `damaged or was truncated`,
    )
  }
  if (manifest.media.entries.length !== manifest.counts.mediaFiles) {
    problems.push(
      `the manifest lists ${manifest.media.entries.length} media entries but claims ` +
        `${manifest.counts.mediaFiles} files`,
    )
  }

  if (deep) onProgress(`Checksumming ${manifest.media.entries.length} media file(s)`)
  for (const entry of manifest.media.entries) {
    const path = join(root, MEDIA_DIR, fromPosix(entry.path))
    const info = await stat(path).catch(() => null)
    if (info === null) {
      problems.push(`media/${entry.path} is missing from the archive`)
      continue
    }
    if (info.size !== entry.bytes) {
      problems.push(`media/${entry.path} is ${info.size} bytes, the manifest says ${entry.bytes}`)
      continue
    }
    checkedFiles += 1
    if (!deep) continue
    const actual = await streamThroughSha256(path, null)
    if (actual.sha256 !== entry.sha256) {
      problems.push(`media/${entry.path} does not match its recorded checksum`)
    }
  }

  // ------------------------------------------ what the backup already knew --
  const [firstGap] = manifest.missingMedia
  if (firstGap !== undefined) {
    warnings.push(
      `${manifest.missingMedia.length} photo row(s) had no bytes on disk when the backup ` +
        `ran; restoring this archive reproduces that gap (first: ${firstGap.photoId})`,
    )
  }
  if (manifest.unreferencedMediaFiles > 0) {
    warnings.push(
      `${manifest.unreferencedMediaFiles} media file(s) are named by no photo row — normal ` +
        `for a backup taken while guests were uploading, and harmless`,
    )
  }
  for (const note of manifest.skipped) warnings.push(`skipped during backup: ${note}`)

  return { ok: problems.length === 0, manifest, problems, warnings, checkedFiles, deep }
}
