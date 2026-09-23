/**
 * `npm run purge` and `npm run purge -- --dry-run`.
 *
 * The retention sweep, on demand. The same use case the server runs on a timer
 * (`src/main/retentionSweeper.ts`), so the two can never drift apart: this is a
 * different trigger, not a second implementation.
 *
 * Two operators want this. The one whose schedule belongs to cron or a systemd timer
 * rather than to the application — they set `RETENTION_SWEEP_INTERVAL_MINUTES=off` and
 * call this — and the one who has just been asked "did that album actually get
 * deleted?" and needs to see the answer rather than infer it from a log file.
 *
 * **Export before you purge.** This deletes; there is no undo and no second take on a
 * wedding album. `--dry-run` lists exactly what a real run would remove, and answers
 * nothing else: it touches no file and no row.
 *
 * Safe to run while the server is up. The deletions are per-event and
 * `MediaStore.deleteEvent` is idempotent, so the worst a race with the in-process sweep
 * produces is an event reported as failed here because the other run had already removed
 * it — the album is gone either way, and the next sweep reconciles anything left.
 */
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { makePurgeExpiredEvents } from '../src/application/usecases/events/purgeExpiredEvents'
import { makeSweepOrphanedMedia } from '../src/application/usecases/media/sweepOrphanedMedia'
import type { LogContext, Logger } from '../src/application/ports/logger'
import { loadMaintenanceConfig } from '../src/infrastructure/config/env'
import { closeDatabase, openDatabase } from '../src/infrastructure/db/connection'
import { SqliteClipJobRepository } from '../src/infrastructure/db/sqliteClipJobRepository'
import { SqliteEventRepository } from '../src/infrastructure/db/sqliteEventRepository'
import { SqlitePhotoRepository } from '../src/infrastructure/db/sqlitePhotoRepository'
import { createFsMediaStore } from '../src/infrastructure/media/fsMediaStore'
import { systemClock } from '../src/infrastructure/time/systemClock'
import { isTooDangerousToSweep, MEDIA_SWEEP_MIN_AGE_MS } from '../src/main/mediaSweeper'

/** The sweep wants a `Logger`; on a terminal that is the console. */
const consoleLogger: Logger = {
  debug: () => {},
  info: (message: string, context?: LogContext) => console.log(`  ${message}`, context ?? ''),
  warn: (message: string, context?: LogContext) => console.warn(`  ${message}`, context ?? ''),
  error: (message: string, context?: LogContext) => console.error(`  ${message}`, context ?? ''),
  child: () => consoleLogger,
}

const main = async (): Promise<number> => {
  const dryRun = process.argv.includes('--dry-run')

  // Only the config module reads the environment; it has already resolved these, and it
  // refuses to hand them over at all if anything else is misconfigured.
  const config = loadMaintenanceConfig()
  const databasePath = config.storage.databasePath
  // Resolved exactly as the container resolves it, so the CLI and the server address the
  // same directory when MEDIA_ROOT is relative.
  const mediaRoot = resolve(config.storage.mediaRoot)

  console.log('EventSlide retention purge')
  console.log(`  database:   ${databasePath}`)
  console.log(`  media root: ${mediaRoot}`)
  if (dryRun) console.log('  mode:       dry run, nothing will be deleted')
  console.log('')

  const db = openDatabase({ path: databasePath })
  try {
    const events = new SqliteEventRepository(db)
    const media = createFsMediaStore({ root: mediaRoot })
    const now = systemClock.now()

    /**
     * **The media reconciliation sweep, because on this box nothing else runs it.**
     *
     * The operator who reaches for this script is the one who set
     * `RETENTION_SWEEP_INTERVAL_MINUTES=off` — which is also the switch the container
     * uses to decide whether to build the collector at all. So without this, the
     * deployment this project documents as supported is the one deployment where a
     * leaked clip source is never collected: the upload path deliberately does not
     * delete, and there would be nothing behind it.
     *
     * Runs on **every** invocation that is not a dry run, including one that purged
     * nothing: the leaks it collects have nothing to do with retention.
     */
    const reconcile = async (): Promise<void> => {
      /**
       * **The same guard the container applies, because this is the same deleter.**
       *
       * `container.ts` refuses to build the reconciliation sweep when `MEDIA_ROOT`
       * resolves somewhere shared — a filesystem root, a home directory, `/var` — and
       * logs that nothing will delete under that root. The line was false while this
       * script, which `docs/SECURITY.md` positions as the fallback collector for exactly
       * the deployments where the container's own sweep is switched off, applied no guard
       * at all and swept anyway.
       *
       * `realpath` first, because `resolve` does not follow symlinks and a media root
       * that is a link to `$HOME` walks straight past a comparison of resolved strings.
       */
      const realRoot = await realpath(mediaRoot).catch(() => mediaRoot)
      if (isTooDangerousToSweep(realRoot)) {
        console.error('')
        console.error('Not reconciling media: MEDIA_ROOT is not a directory of its own.')
        console.error(`  ${realRoot}`)
        console.error('Give it a directory nothing else owns, as compose.yaml does.')
        return
      }

      const sweep = makeSweepOrphanedMedia({
        photos: new SqlitePhotoRepository(db),
        clips: new SqliteClipJobRepository(db),
        media,
        clock: systemClock,
        logger: consoleLogger,
        // No practical bound from a CLI: an operator ran this and is watching it.
        policy: {
          minimumAgeMs: MEDIA_SWEEP_MIN_AGE_MS,
          maxDigestsPerPass: Number.MAX_SAFE_INTEGER,
        },
      })

      const collected = await sweep()
      console.log(
        `Reconciled ${collected.scanned} stored object(s): collected ${collected.collected}, ` +
          `${collected.bytes} byte(s).`,
      )
      for (const id of collected.failed) console.error(`  could not reconcile ${id}`)
    }

    // The same listing the use case sweeps. Read here as well so a dry run can name the
    // events, and so a real run can report a slug for an id that no longer resolves to
    // anything once it has been deleted.
    const due = await events.listDueForPurge(now)

    if (due.length === 0) {
      console.log('Nothing is due for purge.')
      console.log(
        'Only closed or archived events with a retention period reach this list; an event still running is never due.',
      )
      if (!dryRun) await reconcile()
      return 0
    }

    console.log(`Due for purge (${due.length}):`)
    for (const event of due) {
      // `closedAt` is never null for an event this query returns — it is what starts the
      // retention clock and the WHERE clause requires it — but the type is honest and so
      // is this.
      const closedAt = event.closedAt === null ? 'never closed' : event.closedAt.toISOString()
      const retentionDays = event.settings.retentionDays
      console.log(
        `  ${event.id}  ${event.slug.value.padEnd(24)}  closed ${closedAt}  retention ${retentionDays === null ? 'none' : `${retentionDays}d`}`,
      )
    }
    console.log('')

    if (dryRun) {
      console.log('Dry run: nothing was deleted. Re-run without --dry-run to purge.')
      return 0
    }

    const purge = makePurgeExpiredEvents({
      events,
      media,
      clock: systemClock,
    })

    const report = await purge()

    console.log(`Purged ${report.purged.length} event(s).`)
    await reconcile()

    if (report.failed.length > 0) {
      // The exit code and this list are what a cron job mails to the operator at 2am.
      console.error('')
      console.error(`Failed to purge ${report.failed.length} event(s):`)
      for (const id of report.failed) console.error(`  ${id}`)
      console.error('')
      console.error(
        'Their photos are still on disk and their rows are still in the database. Check that',
      )
      console.error(`the disk is writable and not full: ${mediaRoot}`)
      console.error('Nothing is lost; the next run retries them.')
      return 1
    }

    return 0
  } finally {
    // Checkpoints the WAL, so the database file on disk is self-contained afterwards.
    closeDatabase(db)
  }
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Purge failed: ${message}`)
    if (message.includes('no such table')) {
      console.error('The database has no schema yet. Run `npm run db:migrate` first.')
    }
    process.exitCode = 1
  })
