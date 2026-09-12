/**
 * `npm run backup` and `npm run backup:verify`.
 *
 * Takes a verifiable archive of the two things an EventSlide installation is: the
 * SQLite database and the media root. The mechanics, the archive layout and the
 * reasoning about consistency between the two halves all live in
 * `src/infrastructure/db/backupArchive.ts`; this file is the part an operator talks to.
 *
 * A script rather than something the server does on a timer, for the same reason
 * `db:migrate` is one: the output is the interface. A backup that ran silently and
 * wrote nothing useful is the failure everybody discovers too late, so this prints what
 * it captured, what it could not, and what the archive is worth.
 */
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig } from '../src/infrastructure/config/env'
import { migrations } from '../src/infrastructure/db/migrations'
import {
  BackupError,
  createBackup,
  verifyBackup,
  type VerifyReport,
} from '../src/infrastructure/db/backupArchive'

const VERSION = '2.0.0'

const USAGE = `
EventSlide backup

  npm run backup                              back up to ./backups/<timestamp>
  npm run backup -- --to /mnt/usb/wedding     back up to a chosen directory
  npm run backup:verify -- <archive>          prove an existing archive is intact

Options
  --to <directory>        where to write the archive. Must not already hold one.
  --database <path>       override DATABASE_PATH (e.g. a Docker volume)
  --media <path>          override MEDIA_ROOT
  --verify <archive>      check an archive instead of taking one
  --quick                 with --verify: check sizes only, skip the checksums
  --help

The archive is a directory, not a zip: the database snapshot has to land on a path
anyway (VACUUM INTO cannot write to a stream), photos are already compressed, and a
directory can be rsynced, resumed and inspected. Copy it somewhere that is not this
machine — a backup on the same disk survives everything except the thing most likely
to happen to it.
`.trim()

/** Bytes as something a person reads, not a benchmark figure. */
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

/** Colons are not legal in a Windows filename, so the stamp cannot be a plain ISO one. */
const stampOf = (now: Date): string => `${now.toISOString().slice(0, 19).replace(/:/g, '-')}Z`

const printReport = (report: VerifyReport, archive: string): void => {
  for (const warning of report.warnings) console.log(`  note: ${warning}`)

  if (report.ok) {
    console.log(
      `\nOK  ${archive}\n` +
        `    ${report.checkedFiles} file(s) checked` +
        `${report.deep ? ' with full checksums' : ', sizes only (--quick)'}.`,
    )
    if (!report.deep) {
      console.log(
        `    A --quick check catches a truncated or half-copied archive. It does not\n` +
          `    catch a file whose bytes changed while its length did not. Run the full\n` +
          `    check before you rely on this archive.`,
      )
    }
    return
  }

  console.error(`\nFAILED  ${archive}`)
  for (const problem of report.problems) console.error(`  - ${problem}`)
  console.error(
    `\nDo not rely on this archive, and do not let it overwrite the last one you trust.`,
  )
}

const runVerify = async (argv: readonly string[], archive: string): Promise<number> => {
  const target = resolve(archive)
  console.log(`Verifying ${target}`)
  const report = await verifyBackup(target, {
    deep: !flag(argv, 'quick'),
    migrations,
    onProgress: (line) => console.log(`  ${line}`),
  })
  printReport(report, target)
  return report.ok ? 0 : 1
}

const runBackup = async (argv: readonly string[]): Promise<number> => {
  const config = loadConfig()
  // Only the config module reads the environment; the flags exist so an operator can
  // point this at a container volume without editing their .env.
  const databasePath = option(argv, 'database') ?? config.storage.databasePath
  const mediaRoot = option(argv, 'media') ?? config.storage.mediaRoot

  const now = new Date()
  const destination = option(argv, 'to') ?? join('./backups', `eventslide-${stampOf(now)}`)
  await mkdir(resolve(destination, '..'), { recursive: true })

  console.log(`EventSlide backup`)
  console.log(`  database  ${resolve(databasePath)}`)
  console.log(`  media     ${resolve(mediaRoot)}`)
  console.log(`  archive   ${resolve(destination)}`)
  console.log('')

  const { manifest, destination: archive } = await createBackup({
    databasePath,
    mediaRoot,
    destination,
    now,
    appVersion: VERSION,
    onProgress: (line) => console.log(line),
  })

  console.log('')
  console.log(`Captured`)
  console.log(
    `  ${manifest.counts.events} event(s), ${manifest.counts.photos} photo(s), ` +
      `${manifest.counts.guests} guest(s), ${manifest.counts.reactions} reaction(s)`,
  )
  console.log(`  database  ${human(manifest.database.bytes)}`)
  console.log(`  media     ${manifest.counts.mediaFiles} file(s), ${human(manifest.media.bytes)}`)

  if (manifest.missingMedia.length > 0) {
    // The one direction of skew that costs something. Named, not buried in a count:
    // these photo rows restore into broken tiles.
    console.log('')
    console.log(`  ! ${manifest.missingMedia.length} photo row(s) had no bytes on disk.`)
    for (const gap of manifest.missingMedia.slice(0, 10)) {
      console.log(`  !   photo ${gap.photoId} (${gap.variant}) in event ${gap.eventId}`)
    }
    if (manifest.missingMedia.length > 10) {
      console.log(`  !   ... and ${manifest.missingMedia.length - 10} more, in manifest.json`)
    }
    console.log(
      `  ! A photo deleted while the backup ran looks exactly like this and is harmless.\n` +
        `  ! Any other cause is a gap that already existed on disk.`,
    )
  }

  // Proving the archive rather than asserting it: the command has just written every
  // byte, so re-reading them is the only thing that distinguishes "wrote a backup" from
  // "believes it wrote a backup".
  console.log('')
  const report = await verifyBackup(archive, {
    deep: true,
    migrations,
    onProgress: (line) => console.log(`  ${line}`),
  })
  printReport(report, archive)
  if (!report.ok) return 1

  // Without `--force`, deliberately. It is the flag that switches off the refusal to
  // overwrite an existing installation, and a happy path that prints it teaches every
  // operator to paste it — including on the day the target was not supposed to be
  // occupied and the refusal was the thing that would have saved them. The command
  // below is the one that is right nearly every time; the sentence after it is for the
  // other times, which is the order those two facts should be met in.
  console.log(
    `\nCopy it off this machine. Restore with:\n` +
      `  npm run restore -- ${archive}\n` +
      `\nThat refuses to run if the target already holds a database or any media.\n` +
      `Adding --force is what gets past the refusal, and it destroys what is there.`,
  )
  return 0
}

/**
 * The whole command, as a function of its arguments and nothing else.
 *
 * Exported and returning an exit code rather than calling `process.exit`, so the shell
 * an operator actually touches — argument parsing, what is printed, what the exit code
 * says — is testable. A CLI whose only tested part is the library underneath it is a
 * CLI whose argument handling has never been run by anything but a person at 2am.
 */
export const run = async (argv: readonly string[]): Promise<number> => {
  try {
    if (flag(argv, 'help')) {
      console.log(USAGE)
      return 0
    }
    const toVerify = option(argv, 'verify')
    if (toVerify !== null) return await runVerify(argv, toVerify)
    return await runBackup(argv)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  // `exitCode` rather than `exit`, so buffered stdout reaches a terminal or a pipe
  // before the process goes away.
  void run(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
