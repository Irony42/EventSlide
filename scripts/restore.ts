/**
 * `npm run restore`.
 *
 * Writes an archive produced by `npm run backup` back over a database and a media root.
 *
 * This command destroys data by design, so it is built to be hard to use by accident:
 * it verifies the whole archive before it touches anything, it refuses outright if the
 * target holds a database or any media, and the only way past that is `--force` — which
 * prints exactly what it is about to destroy, in the output, where somebody rerunning a
 * half-remembered command will actually read it. `--dry-run` does everything except the
 * writing.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig } from '../src/infrastructure/config/env'
import { migrations } from '../src/infrastructure/db/migrations'
import {
  BackupError,
  inspectRestoreTarget,
  readManifest,
  restoreBackup,
  verifyBackup,
  type RestoreTarget,
} from '../src/infrastructure/db/backupArchive'

const USAGE = `
EventSlide restore

  npm run restore -- <archive>                     restore into an empty installation
  npm run restore -- <archive> --force             overwrite what is there now
  npm run restore -- <archive> --dry-run           verify and print the plan, write nothing

Options
  --database <path>       override DATABASE_PATH (e.g. a Docker volume)
  --media <path>          override MEDIA_ROOT
  --force                 required to overwrite an existing database or media root
  --dry-run               verify the archive and report, without writing
  --help

Stop the server first. Restoring underneath a running EventSlide replaces the file it
has open, and what the wall shows after that is neither the old data nor the new.
`.trim()

const flag = (argv: readonly string[], name: string): boolean => argv.includes(`--${name}`)

const option = (argv: readonly string[], name: string): string | null => {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return null
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new BackupError(`--${name} needs a value`)
  }
  return value
}

/** The archive path, positional. Skips anything consumed as an option's value. */
const positional = (argv: readonly string[]): string | null => {
  const consumed = new Set<number>()
  for (const [index, token] of argv.entries()) {
    if (!token.startsWith('--')) continue
    consumed.add(index)
    if (['--database', '--media'].includes(token)) consumed.add(index + 1)
  }
  for (const [index, token] of argv.entries()) {
    if (!consumed.has(index)) return token
  }
  return null
}

const human = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}

/**
 * The part of this command that matters.
 *
 * Printed before anything is written, and only when there is genuinely something to
 * lose, so it never becomes the banner an operator learns to scroll past.
 */
const printDanger = (target: RestoreTarget): void => {
  console.log('')
  console.log('  !!  THIS WILL DESTROY THE DATA BELOW  !!')
  console.log('  !!')
  if (target.databaseBytes !== null) {
    console.log(`  !!  database   ${target.databasePath}`)
    console.log(`  !!             ${human(target.databaseBytes)}, replaced`)
  }
  if (target.mediaFiles > 0) {
    console.log(`  !!  media      ${target.mediaRoot}`)
    console.log(
      `  !!             ${target.mediaFiles} file(s), ${human(target.mediaBytes)}, deleted`,
    )
  }
  console.log('  !!')
  console.log('  !!  --force was given, so this is going ahead.')
  console.log('')
}

const runDryRun = async (archive: string, target: RestoreTarget): Promise<number> => {
  console.log('')
  console.log('Dry run: verifying the archive, writing nothing.')
  const report = await verifyBackup(archive, {
    deep: true,
    migrations,
    onProgress: (line) => console.log(`  ${line}`),
  })
  for (const warning of report.warnings) console.log(`  note: ${warning}`)
  if (!report.ok) {
    console.error('')
    console.error('FAILED  this archive is not safe to restore:')
    for (const problem of report.problems) console.error(`  - ${problem}`)
    return 1
  }
  console.log('')
  console.log(`OK  the archive is intact (${report.checkedFiles} file(s) checked).`)
  if (target.occupied) {
    console.log(`    Restoring it would destroy the database and media listed above;`)
    console.log(`    the real run needs --force.`)
  } else {
    console.log(`    The target is empty, so the real run needs no --force.`)
  }
  return 0
}

const restore = async (argv: readonly string[]): Promise<number> => {
  const archive = positional(argv)
  if (archive === null) {
    throw new BackupError('Which archive? Pass the directory npm run backup wrote.')
  }

  const config = loadConfig()
  const databasePath = option(argv, 'database') ?? config.storage.databasePath
  const mediaRoot = option(argv, 'media') ?? config.storage.mediaRoot
  const force = flag(argv, 'force')

  const manifest = await readManifest(archive)
  const target = await inspectRestoreTarget(databasePath, mediaRoot)

  console.log('EventSlide restore')
  console.log(`  archive   ${resolve(archive)}`)
  console.log(`            taken ${manifest.createdAt} by EventSlide ${manifest.appVersion}`)
  console.log(
    `            ${manifest.counts.events} event(s), ${manifest.counts.photos} photo(s), ` +
      `${manifest.counts.mediaFiles} media file(s), ${human(manifest.media.bytes)}`,
  )
  console.log(`  database  ${target.databasePath}`)
  console.log(`  media     ${target.mediaRoot}`)

  if (target.liveJournal) {
    // -wal/-shm beside the database means a connection is open, or was not closed
    // cleanly. Replacing the file underneath a running server is how a restore that
    // reported success ends up serving a mixture of two databases.
    console.log('')
    console.log(`  !  ${target.databasePath}-wal or -shm is present.`)
    console.log(`  !  A server is probably still running. Stop it before restoring.`)
  }

  if (flag(argv, 'dry-run')) return runDryRun(archive, target)

  if (target.occupied && force) printDanger(target)

  const result = await restoreBackup({
    archive,
    databasePath,
    mediaRoot,
    force,
    migrations,
    onProgress: (line) => console.log(line),
  })

  console.log('')
  console.log('Restored')
  console.log(
    `  ${result.manifest.counts.events} event(s), ${result.manifest.counts.photos} photo(s), ` +
      `${result.mediaFilesWritten} media file(s)`,
  )
  if (result.migrationsApplied.length > 0) {
    console.log(
      `  ${result.migrationsApplied.length} migration(s) applied to bring the restored ` +
        `database up to this build: ${result.migrationsApplied.join(', ')}`,
    )
  } else {
    console.log(`  the schema already matches this build; nothing to migrate`)
  }
  if (result.manifest.missingMedia.length > 0) {
    console.log(
      `  ! ${result.manifest.missingMedia.length} photo row(s) had no bytes when the backup ` +
        `was taken and have none now; they will render as broken tiles`,
    )
  }
  console.log('')
  console.log('Start the server and check the wall before you tell anyone it is back.')
  return 0
}

/**
 * The whole command, as a function of its arguments. See `scripts/backup.ts` for why
 * this is exported and returns an exit code instead of calling `process.exit`.
 */
export const run = async (argv: readonly string[]): Promise<number> => {
  if (flag(argv, 'help') || argv.length === 0) {
    console.log(USAGE)
    return 0
  }
  try {
    return await restore(argv)
  } catch (error) {
    console.error('')
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  void run(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
