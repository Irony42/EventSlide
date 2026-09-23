/**
 * `npm run backup` and `npm run backup:verify` — in the image,
 * `node dist/ops/scripts/backup.js` and `… --verify`.
 *
 * Takes a verifiable archive of the two things an EventSlide installation is: the
 * SQLite database and the media root. The mechanics, the archive layout and the
 * reasoning about consistency between the two halves all live in
 * `src/infrastructure/db/backupArchive.ts`; this file is the part an operator talks to.
 *
 * A script rather than something the server does on a timer, because the output is the
 * interface. A backup that ran silently and wrote nothing useful is the failure
 * everybody discovers too late, so this prints what it captured, what it could not, and
 * what the archive is worth.
 */
import { mkdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { loadMaintenanceConfig } from '../src/infrastructure/config/env'
import { migrations } from '../src/infrastructure/db/migrations'
import {
  BackupError,
  createBackup,
  verifyBackup,
  type VerifyReport,
} from '../src/infrastructure/db/backupArchive'
import { commandLine, invocationOf, type Invocation, type OperatorCommand } from './invocation'

const VERSION = '2.0.0'

const usage = (invocation: Invocation): string => {
  const line = (command: OperatorCommand, args: string, what: string): string =>
    `  ${commandLine(invocation, command, args).padEnd(53)} ${what}`
  return `
EventSlide backup

${line('backup', '', 'back up to BACKUP_DIR/eventslide-<timestamp>')}
${line('backup', '--to /mnt/usb/wedding', 'back up to a chosen directory')}
${line('verify', '<archive>', 'prove an existing archive is intact')}

Options
  --to <directory>        where to write the archive. Must not already hold one.
                          Without it: BACKUP_DIR, which is ./backups unless set.
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
}

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

/**
 * Do these two paths live on one filesystem?
 *
 * `st_dev` rather than a guess from the path, because the path cannot tell: inside the
 * container `/data/backups` and a bind-mounted `/backups` are both on the host's disk,
 * while `/tmp` is a tmpfs. A stat that fails answers "no" — this only decides whether a
 * warning is printed, and a backup that has already verified must not exit 1 over it.
 */
const sharesFilesystem = async (a: string, b: string): Promise<boolean> => {
  try {
    return (await stat(a)).dev === (await stat(b)).dev
  } catch {
    return false
  }
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

const runBackup = async (argv: readonly string[], invocation: Invocation): Promise<number> => {
  const config = loadMaintenanceConfig()
  // Only the config module reads the environment; the flags exist so an operator can
  // point this at a container volume without editing their .env.
  const databasePath = option(argv, 'database') ?? config.storage.databasePath
  const mediaRoot = option(argv, 'media') ?? config.storage.mediaRoot

  const now = new Date()
  // BACKUP_DIR, not a literal `./backups`: that resolves against the working directory,
  // which in the image is a read-only `/app`. See the variable in env.ts.
  const destination =
    option(argv, 'to') ?? join(config.storage.backupDir, `eventslide-${stampOf(now)}`)
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

  // Measured, not assumed, and said only when true. Both defaults land here: the image's
  // BACKUP_DIR is on the data volume, and a checkout's `./backups` sits beside `./data`.
  // An "OK" over an archive on the same disk as the album is the one success message
  // that should not reassure anybody, and a reader cannot see a device number.
  if (await sharesFilesystem(archive, databasePath)) {
    console.log(
      `\n  ! This archive is on the same filesystem as the database it was taken from, so\n` +
        `  ! the disk failure that loses one loses both. It is not a backup until a copy\n` +
        `  ! of it is somewhere else.`,
    )
  }

  // Without `--force`, deliberately. It is the flag that switches off the refusal to
  // overwrite an existing installation, and a happy path that prints it teaches every
  // operator to paste it — including on the day the target was not supposed to be
  // occupied and the refusal was the thing that would have saved them. The command
  // below is the one that is right nearly every time; the sentence after it is for the
  // other times, which is the order those two facts should be met in.
  console.log(
    `\nCopy it off this machine. Restore with, once the server is stopped:\n` +
      `  ${commandLine(invocation, 'restore', archive)}`,
  )
  if (invocation === 'node') {
    // The operator reading this has just typed `docker compose exec`, and the natural
    // thing is to paste the line above behind the same prefix — which runs the restore
    // beside the live server, the one race the procedure exists to avoid. Nothing in
    // the restore can refuse it (see `scripts/restore.ts`), so the output says it.
    console.log(
      `In Docker that is \`docker compose stop eventslide\`, then the line above behind\n` +
        `\`docker compose run --rm eventslide\` — never behind \`exec\`, which would run it\n` +
        `beside the live server.`,
    )
  }
  console.log(
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
 *
 * `invocation` decides only how the commands it prints are spelled — see
 * `./invocation.ts`. It defaults to the source checkout, which is what every test that
 * does not say otherwise is about.
 */
export const run = async (
  argv: readonly string[],
  invocation: Invocation = 'npm',
): Promise<number> => {
  try {
    if (flag(argv, 'help')) {
      console.log(usage(invocation))
      return 0
    }
    const toVerify = option(argv, 'verify')
    if (toVerify !== null) return await runVerify(argv, toVerify)
    return await runBackup(argv, invocation)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

/**
 * Run as a program, and not when a test imports `run`.
 *
 * `require.main === module` rather than the `import.meta.url` comparison this used to
 * be, because the image runs this file compiled to CommonJS by `tsconfig.ops.json`, and
 * `import.meta` does not exist there — tsc refuses it outright. tsx already ran it as
 * CommonJS, `package.json` having no `"type"`, so the one check means the same thing
 * under `npm run backup`, under `node dist/ops/scripts/backup.js`, and under vitest,
 * where `require.main` is the runner's own entry and never this module.
 */
if (require.main === module) {
  // `exitCode` rather than `exit`, so buffered stdout reaches a terminal or a pipe
  // before the process goes away.
  void run(process.argv.slice(2), invocationOf(__filename)).then((code) => {
    process.exitCode = code
  })
}
