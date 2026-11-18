/**
 * `npm run export -- --due-within 14 --to /mnt/nas/albums` — in the image,
 * `node dist/ops/scripts/export.js …`.
 *
 * The self-hoster's step before the purge (spec 22, section 8), to run from cron ahead of
 * `npm run purge`: for each album whose deletion date falls within N days, writes **the same verified
 * archive** the host's button makes (same loop, same four checks) into a folder **outside the box**,
 * `<to>/<slug>-<deletion date>/album.zip` and `MANIFEST.sha256`, prints what it holds (files, size,
 * digest, missing) and **exits 1 if a single album failed**, so the cron job hears.
 *
 * - `--event <slug>` takes one album (alone, whatever its date, once the evening is over).
 * - `--dry-run` lists what would be written and writes nothing, not even the folder.
 * - `--to` may not be in, around or on `DATABASE_PATH` / `MEDIA_ROOT` (real paths, as `backup` and
 *   `restore` judge them).
 *
 * **The database is opened read-only, always**: this command writes no row. A copy on the operator's
 * USB key is not an archive sent to the host (`event_exports` is untouched), and what is written
 * outside the box is no longer the notice's business: the operator, who is the host of a self-hosted
 * box, is responsible for it, and the command says so.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeExportAlbumToFolder } from '../src/application/usecases/exports/exportAlbumToFolder'
import { makeSelectAlbumsToExport } from '../src/application/usecases/exports/selectAlbumsToExport'
import { Slug } from '../src/domain/shared/slug'
import { loadMaintenanceConfig } from '../src/infrastructure/config/env'
import { sha256StreamHasher } from '../src/infrastructure/crypto/sha256StreamHasher'
import { closeDatabase, openDatabase } from '../src/infrastructure/db/connection'
import { assertArchiveApart } from '../src/infrastructure/db/backup/containment'
import { BackupError } from '../src/infrastructure/db/backup/backupError'
import { freeBytesOnFilesystemOf } from '../src/infrastructure/db/backup/createBackup'
import { SqliteClientRepository } from '../src/infrastructure/db/sqliteClientRepository'
import { SqliteEventRepository } from '../src/infrastructure/db/sqliteEventRepository'
import { SqliteGuestbookRepository } from '../src/infrastructure/db/sqliteGuestbookRepository'
import { SqliteGuestbookVoiceRepository } from '../src/infrastructure/db/sqliteGuestbookVoiceRepository'
import { SqliteGuestRepository } from '../src/infrastructure/db/sqliteGuestRepository'
import { SqlitePhotoRepository } from '../src/infrastructure/db/sqlitePhotoRepository'
import { archiverWriter } from '../src/infrastructure/media/archiverWriter'
import { createFsExportFolderStore } from '../src/infrastructure/media/fsExportFolderStore'
import { createFsMediaStore } from '../src/infrastructure/media/fsMediaStore'
import { systemClock } from '../src/infrastructure/time/systemClock'
import { consoleLogger } from './purge'

const USAGE = `
Usage: npm run export -- [--due-within <days>] [--event <slug>] --to <directory> [--dry-run]

  --due-within <days>  albums the box will delete within this many days (already due included)
  --event <slug>       one album; alone, whatever its deletion date, once the evening is over
  --to <directory>     where the copies go: outside DATABASE_PATH and MEDIA_ROOT
  --dry-run            list what would be written and write nothing
`.trim()

class UsageError extends Error {}

export const human = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}

interface Options {
  readonly dueWithinDays: number | null
  readonly slug: Slug | null
  readonly to: string | null
  readonly dryRun: boolean
}

const valueOf = (argv: readonly string[], name: string): string | null => {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return null
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} needs a value`)
  return value
}

/** Exported for the test: the whole of the command line, validated. */
export const parseOptions = (argv: readonly string[]): Options => {
  const known = new Set(['--due-within', '--event', '--to', '--dry-run'])
  for (const arg of argv) {
    if (arg.startsWith('--') && !known.has(arg)) throw new UsageError(`unknown option ${arg}`)
  }
  const within = valueOf(argv, 'due-within')
  let dueWithinDays: number | null = null
  if (within !== null) {
    if (!/^\d{1,4}$/.test(within)) {
      throw new UsageError('--due-within takes a whole number of days, 0 to 9999')
    }
    dueWithinDays = Number(within)
  }
  const slugText = valueOf(argv, 'event')
  let slug: Slug | null = null
  if (slugText !== null) {
    const made = Slug.create(slugText)
    if (!made.ok) throw new UsageError(`--event ${slugText} is not an event slug`)
    slug = made.value
  }
  if (dueWithinDays === null && slug === null) {
    throw new UsageError('say which albums: --due-within <days> and/or --event <slug>')
  }
  const dryRun = argv.includes('--dry-run')
  const to = valueOf(argv, 'to')
  if (to === null && !dryRun) throw new UsageError('--to <directory> is required')
  return { dueWithinDays, slug, to, dryRun }
}

const execute = async (
  argv: readonly string[],
  env: NodeJS.ProcessEnv | undefined,
): Promise<number> => {
  const { dueWithinDays, slug, to, dryRun } = parseOptions(argv)
  const config = loadMaintenanceConfig(env)
  const databasePath = config.storage.databasePath
  const mediaRoot = resolve(config.storage.mediaRoot)
  const capNoticeDays = config.retention.capNoticeDays

  console.log('EventSlide album export')
  console.log(`  database:   ${databasePath}`)
  console.log(`  media root: ${mediaRoot}`)
  console.log(`  to:         ${to === null ? '(not given)' : resolve(to)}`)
  if (dryRun) console.log('  mode:       dry run, nothing will be written')
  console.log('')

  if (!existsSync(databasePath)) {
    console.error(`Export failed: there is no database at ${databasePath}.`)
    console.error('Check DATABASE_PATH. The server creates the database the first time it starts.')
    return 1
  }

  // Before anything is opened or created: a `--to` that overlaps the box is refused untouched.
  if (to !== null) {
    await assertArchiveApart({ archive: to, mediaRoot, databasePath, operation: 'export' })
  }

  // Read-only whatever the mode: this command writes no row.
  const db = openDatabase({ path: databasePath, readonly: true })
  try {
    const events = new SqliteEventRepository(db)
    const clients = new SqliteClientRepository(db)
    const select = makeSelectAlbumsToExport({
      events,
      clients,
      clock: systemClock,
      capNoticeDays,
    })

    const selection = await select({ dueWithinDays, slug })
    if (selection.kind === 'unknownEvent') {
      console.error(`Export failed: no event has the slug ${selection.slug}.`)
      return 1
    }
    if (selection.kind === 'notClosed') {
      console.error(
        `Export failed: ${selection.slug} is not over (draft or live): its album is not final.`,
      )
      return 1
    }

    const { albums } = selection
    if (albums.length === 0) {
      console.log('No album to export.')
      return 0
    }

    console.log(`Albums to export (${albums.length}):`)
    for (const { event, deadline, folder } of albums) {
      const when = deadline === null ? 'no deletion date' : `deleted ${deadline.toISOString()}`
      console.log(`  ${event.slug.value.padEnd(24)}  ${when}  ->  ${folder}/`)
    }
    console.log('')

    if (dryRun || to === null) {
      console.log('Dry run: nothing was written. Re-run without --dry-run to write the copies.')
      return 0
    }

    const exportToFolder = makeExportAlbumToFolder({
      photos: new SqlitePhotoRepository(db),
      guestbook: new SqliteGuestbookRepository(db),
      voices: new SqliteGuestbookVoiceRepository(db),
      guests: new SqliteGuestRepository(db),
      media: createFsMediaStore({ root: mediaRoot }),
      archive: archiverWriter,
      streamHasher: sha256StreamHasher,
      folders: createFsExportFolderStore(to),
      clock: systemClock,
      logger: consoleLogger,
      freeDiskBytes: () => freeBytesOnFilesystemOf(to),
      minFreeDiskBytes: config.storage.minFreeDiskBytes,
    })

    let failures = 0
    for (const { event, folder } of albums) {
      const outcome = await exportToFolder(event, folder)
      if (outcome.kind === 'failed') {
        failures += 1
        console.error(
          `  FAILED  ${event.slug.value}  ${outcome.code}  (an earlier copy in ${folder}/ is untouched)`,
        )
        continue
      }
      console.log(
        `  ok      ${event.slug.value}  files=${outcome.entries}  size=${human(outcome.bytes)}  ` +
          `sha256=${outcome.sha256}  missing=${outcome.skipped}  ${folder}/`,
      )
      if (outcome.skipped > 0) {
        console.warn(
          `          ${outcome.skipped} file(s) were missing from the box's disk and are not in this copy.`,
        )
      }
    }

    console.log('')
    console.log(`Written ${albums.length - failures} of ${albums.length}.`)
    console.log(
      'These copies are outside the box: from here you are responsible for them, and the notice the guests read no longer covers them.',
    )
    console.log('Nothing was marked as sent to the host.')
    if (failures > 0) {
      console.error(
        `${failures} album(s) failed. Fix the cause and run the command again before the purge.`,
      )
      return 1
    }
    return 0
  } finally {
    closeDatabase(db)
  }
}

/** The whole command as a function of its arguments, returning an exit code; never `process.exit`. */
export const run = async (argv: readonly string[], env?: NodeJS.ProcessEnv): Promise<number> => {
  try {
    return await execute(argv, env)
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`Export failed: ${error.message}`)
      console.error('')
      console.error(USAGE)
      return 2
    }
    if (error instanceof BackupError) {
      console.error(error.message)
      return 1
    }
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Export failed: ${message}`)
    if (message.includes('no such table')) {
      console.error(
        'The database has no schema yet. Start the server once, which applies the migrations.',
      )
    }
    return 1
  }
}

if (require.main === module)
  void run(process.argv.slice(2)).then((code) => (process.exitCode = code))
