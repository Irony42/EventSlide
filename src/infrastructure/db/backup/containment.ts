import { realpath, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { BackupError } from './backupError'

/**
 * Where an archive may live relative to the installation it saves or replaces.
 *
 * `restore` empties the media root before it copies the archive's media into it, and
 * `backup` walks the media root while it writes the archive. Either one with the other
 * inside it destroys data: the restore deletes the archive it is reading from after the
 * database is already replaced, and the backup copies its own half-written output into
 * itself. Nothing in the image's default layout does this (`/data/media` and
 * `/data/backups` are siblings); an operator-chosen `--to`, or `MEDIA_ROOT=/data` beside
 * the default `BACKUP_DIR`, does.
 *
 * The comparison is on **real paths**, so a symlink or a Windows junction cannot hide a
 * containment, and on **folded case** where the filesystem folds it, so `C:\Data\Media`
 * and `c:\data\media` are one place. A path that does not exist yet (a destination about
 * to be created) has no `realpath`: its nearest existing ancestor is resolved and the
 * missing tail is appended as written.
 */

interface Place {
  /** The real path, with case folded when the filesystem folds it. */
  readonly key: string
  /** The real path as it should be shown to an operator. */
  readonly shown: string
}

/** Does the directory holding `existing` treat a name that differs only in case as the same entry? */
const foldsCase = async (existing: string): Promise<boolean> => {
  const name = basename(existing)
  const swapped = [...name]
    .map((char) => (char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase()))
    .join('')
  if (swapped === name) return process.platform === 'win32' || process.platform === 'darwin'
  const [real, other] = await Promise.all([
    stat(existing, { bigint: true }).catch(() => null),
    stat(join(dirname(existing), swapped), { bigint: true }).catch(() => null),
  ])
  if (real === null) return false
  return other !== null && other.ino === real.ino && other.dev === real.dev
}

const placeOf = async (path: string): Promise<Place> => {
  const absolute = resolve(path)
  const tail: string[] = []
  let probe = absolute
  for (;;) {
    try {
      const real = await realpath(probe)
      const shown = join(real, ...tail)
      return { key: (await foldsCase(real)) ? shown.toLowerCase() : shown, shown }
    } catch {
      const parent = dirname(probe)
      // Nothing on the way up exists, not even the root: compare what was written.
      if (parent === probe) return { key: absolute, shown: absolute }
      tail.unshift(basename(probe))
      probe = parent
    }
  }
}

/** `child` is `parent`, or somewhere below it. */
const isWithin = (child: Place, parent: Place): boolean => {
  // A plain prefix test on the keys, not `path.relative`: on Windows that one folds case
  // by itself, which would make the folding decided above untestable and, on a
  // case-sensitive volume mounted there, wrong.
  const prefix = parent.key.endsWith(sep) ? parent.key : parent.key + sep
  return child.key === parent.key || child.key.startsWith(prefix)
}

export interface ArchivePlacement {
  /** The archive directory: the one a backup is about to write, or a restore reads. */
  readonly archive: string
  readonly mediaRoot: string
  readonly databasePath: string
  readonly operation: 'backup' | 'restore'
}

/**
 * Refuses, with a `BackupError` that names both paths and says what to do, when the
 * archive and the installation overlap. Read-only; call it before anything is written.
 */
export const assertArchiveApart = async ({
  archive,
  mediaRoot,
  databasePath,
  operation,
}: ArchivePlacement): Promise<void> => {
  const [archivePlace, mediaPlace, databasePlace] = await Promise.all([
    placeOf(archive),
    placeOf(mediaRoot),
    placeOf(databasePath),
  ])

  const restoring = operation === 'restore'
  const advice =
    operation === 'restore'
      ? 'Copy the archive somewhere outside both (another directory beside the media root, ' +
        'not under it), then restore from the copy.'
      : 'Pass --to a directory outside both, such as a sibling of the media root (the ' +
        'default BACKUP_DIR, /data/backups, is one when MEDIA_ROOT is /data/media).'

  if (isWithin(archivePlace, mediaPlace)) {
    throw new BackupError(
      `Refusing: the archive is inside the media root.\n` +
        `  archive   ${archivePlace.shown}\n` +
        `  media     ${mediaPlace.shown}\n` +
        `${restoring ? 'A restore empties the media root before it copies the archive in, so it would delete the archive it is reading from. ' : 'A backup walks the media root while it writes, so it would copy its own output into itself. '}` +
        `Nothing was touched. ${advice}`,
    )
  }
  if (isWithin(mediaPlace, archivePlace)) {
    throw new BackupError(
      `Refusing: the media root is inside the archive.\n` +
        `  archive   ${archivePlace.shown}\n` +
        `  media     ${mediaPlace.shown}\n` +
        `${restoring ? 'A restore empties the media root, which would delete part of the archive it is reading from. ' : 'A backup would be copying the tree it is writing into. '}` +
        `Nothing was touched. ${advice}`,
    )
  }

  // The database file, and the three names a restore writes or removes beside it.
  for (const suffix of ['', '-wal', '-shm', '.restoring']) {
    const sibling = await placeOf(`${databasePath}${suffix}`)
    if (isWithin(sibling, archivePlace)) {
      throw new BackupError(
        `Refusing: the database is inside the archive.\n` +
          `  archive   ${archivePlace.shown}\n` +
          `  database  ${databasePlace.shown}\n` +
          `${restoring ? 'A restore deletes and rewrites the database file, which would damage the archive it is reading from. ' : 'A backup writes its snapshot into the archive, beside the live database. '}` +
          `Nothing was touched. ${advice}`,
      )
    }
  }
}
