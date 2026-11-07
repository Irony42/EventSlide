/**
 * `npm run purge` and `npm run purge -- --dry-run` — in the image,
 * `node dist/ops/scripts/purge.js [--dry-run]`.
 *
 * The retention sweep, on demand. The purge is the same use case the server runs on a timer
 * (`src/main/retentionSweeper.ts`), and the steps that follow it — finalising offboarded
 * clients, then pruning the audit log — are the very function the timer calls
 * (`makeRetentionFollowUp`), not a copy: this is a different trigger, not a second
 * implementation, so an operator who set `RETENTION_SWEEP_INTERVAL_MINUTES=off` gets the
 * whole sweep from this command. On top of that it reconciles the media store, which on that
 * deployment nothing else does (see `reconcile` below).
 *
 * `run(argv, env)` is exported and returns an exit code, the way `backup.ts` does, so the
 * command can be driven from a test; the thin entry at the bottom only runs when this file is
 * the program.
 *
 * Two operators want this. The one whose schedule belongs to cron or a systemd timer
 * rather than to the application — they set `RETENTION_SWEEP_INTERVAL_MINUTES=off` and
 * call this — and the one who has just been asked "did that album actually get
 * deleted?" and needs to see the answer rather than infer it from a log file.
 *
 * **Export before you purge.** This deletes; there is no undo and no second take on a
 * wedding album. `--dry-run` lists exactly what a real run would remove, and answers
 * nothing else: it opens the database read-only, so it touches no file and no row, and a
 * path that does not exist is refused rather than created.
 *
 * Safe to run while the server is up. The deletions are per-event and
 * `MediaStore.deleteEvent` is idempotent, so the worst a race with the in-process sweep
 * produces is an event reported as failed here because the other run had already removed
 * it — the album is gone either way, and the next sweep reconciles anything left.
 */
import { existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { makePruneAuditLog } from '../src/application/usecases/audit/pruneAuditLog'
import { makeFinalizeOffboardedClients } from '../src/application/usecases/clients/finalizeOffboardedClients'
import { makePurgeExpiredEvents } from '../src/application/usecases/events/purgeExpiredEvents'
import { makeSweepOrphanedMedia } from '../src/application/usecases/media/sweepOrphanedMedia'
import type { LogContext, Logger } from '../src/application/ports/logger'
import { loadMaintenanceConfig } from '../src/infrastructure/config/env'
import { closeDatabase, openDatabase } from '../src/infrastructure/db/connection'
import { SqliteAccountHoldings } from '../src/infrastructure/db/sqliteAccountHoldings'
import { SqliteAuditLog } from '../src/infrastructure/db/sqliteAuditLog'
import { SqliteClientRepository } from '../src/infrastructure/db/sqliteClientRepository'
import { SqliteClipJobRepository } from '../src/infrastructure/db/sqliteClipJobRepository'
import { SqliteReelRepository } from '../src/infrastructure/db/sqliteReelRepository'
import { SqliteEventRepository } from '../src/infrastructure/db/sqliteEventRepository'
import { SqlitePhotoRepository } from '../src/infrastructure/db/sqlitePhotoRepository'
import { SqliteUserRepository } from '../src/infrastructure/db/sqliteUserRepository'
import { createFsBookFileStore } from '../src/infrastructure/media/fsBookFileStore'
import { createFsMediaStore } from '../src/infrastructure/media/fsMediaStore'
import { systemClock } from '../src/infrastructure/time/systemClock'
import { isTooDangerousToSweep, MEDIA_SWEEP_MIN_AGE_MS } from '../src/main/mediaSweeper'
import { makeRetentionFollowUp } from '../src/main/retentionSweeper'

/** The sweep wants a `Logger`; on a terminal that is the console. */
const consoleLogger: Logger = {
  debug: () => {},
  info: (message: string, context?: LogContext) => console.log(`  ${message}`, context ?? ''),
  warn: (message: string, context?: LogContext) => console.warn(`  ${message}`, context ?? ''),
  error: (message: string, context?: LogContext) => console.error(`  ${message}`, context ?? ''),
  child: () => consoleLogger,
}

const execute = async (argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> => {
  const dryRun = argv.includes('--dry-run')

  // Only the config module reads the environment; it has already resolved these, and it
  // refuses to hand them over at all if anything else is misconfigured.
  const config = loadMaintenanceConfig(env)
  const databasePath = config.storage.databasePath
  // Resolved exactly as the container resolves it, so the CLI and the server address the
  // same directory when MEDIA_ROOT is relative.
  const mediaRoot = resolve(config.storage.mediaRoot)
  // One number for the listing and for the sweep: a dry run that listed under one notice and a
  // purge that swept under another would be a dry run that lies.
  const capNoticeDays = config.retention.capNoticeDays

  console.log('EventSlide retention purge')
  console.log(`  database:   ${databasePath}`)
  console.log(`  media root: ${mediaRoot}`)
  if (dryRun) console.log('  mode:       dry run, nothing will be deleted')
  console.log('')

  // A purge works on a database the server has already created. A path that does not exist is
  // a typo or the wrong box: opening it would create an empty database there, report a
  // missing schema, and give a hint that is wrong.
  if (!existsSync(databasePath)) {
    console.error(`Purge failed: there is no database at ${databasePath}.`)
    console.error(
      'Check DATABASE_PATH. The server creates the database the first time it starts; this command never does.',
    )
    return 1
  }

  // A dry run opens the database read-only: "touches no file and no row" is then enforced by
  // SQLite and not only promised.
  const db = openDatabase({ path: databasePath, readonly: dryRun })
  try {
    const events = new SqliteEventRepository(db)
    const media = createFsMediaStore({ root: mediaRoot })
    const now = systemClock.now()

    /**
     * **The steps the timer runs after its purge, from the same function.** It never rejects;
     * it reports a step that failed on the logger, and this wrapper turns that into an exit
     * code so a cron job hears about it. Not run on a dry run: that answers the listing only.
     */
    let followUpErrors = 0
    const followUpLogger: Logger = {
      ...consoleLogger,
      error: (message: string, context?: LogContext) => {
        followUpErrors += 1
        consoleLogger.error(message, context)
      },
      child: () => followUpLogger,
    }
    const followUp = async (): Promise<boolean> => {
      await makeRetentionFollowUp({
        finalizeOffboardedClients: makeFinalizeOffboardedClients({
          clients: new SqliteClientRepository(db),
          users: new SqliteUserRepository(db),
          holdings: new SqliteAccountHoldings(db),
          audit: new SqliteAuditLog(db),
          clock: systemClock,
        }),
        pruneAuditLog: makePruneAuditLog({
          audit: new SqliteAuditLog(db),
          clock: systemClock,
          retentionDays: config.audit.retentionDays,
        }),
        logger: followUpLogger,
      })()
      return followUpErrors > 0
    }

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
        // The settings name a host's venue photograph, which no row of either kind does: without
        // this the script would collect it (ADR 0010, decision 8).
        events,
        photos: new SqlitePhotoRepository(db),
        clips: new SqliteClipJobRepository(db),
        // The montage's file is named by its row: without this the script would collect it.
        reels: new SqliteReelRepository(db),
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
    const due = await events.listDueForPurge(now, { capNoticeDays })

    if (due.length === 0) {
      console.log('Nothing is due for purge.')
      console.log(
        'Only closed or archived events with a retention period (their own, or their client’s ceiling) reach this list; an event still running is never due.',
      )
      if (dryRun) return 0
      // Nothing to purge is not nothing to do: offboarded clients whose albums went earlier
      // are finalised here, and the audit log ages whether or not an event is due.
      const failed = await followUp()
      await reconcile()
      return failed ? 1 : 0
    }

    console.log(`Due for purge (${due.length}):`)
    for (const event of due) {
      // `closedAt` is never null for an event this query returns — it is what starts the
      // retention clock and the WHERE clause requires it — but the type is honest and so
      // is this.
      const closedAt = event.closedAt === null ? 'never closed' : event.closedAt.toISOString()
      const retentionDays = event.settings.retentionDays
      console.log(
        `  ${event.id}  ${event.slug.value.padEnd(24)}  closed ${closedAt}  retention ${retentionDays === null ? 'none of its own (its client’s terms apply)' : `${retentionDays}d`}`,
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
      // Deleted with the album, as the timer does: the book PDF is the album's own file.
      bookFiles: createFsBookFileStore(mediaRoot),
      clock: systemClock,
      capNoticeDays,
    })

    const report = await purge()

    console.log(`Purged ${report.purged.length} event(s).`)
    const followUpFailed = await followUp()
    await reconcile()

    if (report.failed.length > 0) {
      // The exit code and this list are what a cron job mails to the operator at 2am.
      console.error('')
      console.error(`Failed to purge ${report.failed.length} event(s):`)
      for (const id of report.failed) console.error(`  ${id}`)
      console.error('')
      console.error(
        'Their files may still be on disk, and a row that could not be deleted is still in the',
      )
      console.error(`database. Check that the disk is writable and not full: ${mediaRoot}`)
      console.error(
        'The next run retries them, and the media reconciliation collects leftover files.',
      )
      return 1
    }

    return followUpFailed ? 1 : 0
  } finally {
    // Checkpoints the WAL, so the database file on disk is self-contained afterwards.
    closeDatabase(db)
  }
}

/**
 * The whole command, as a function of its arguments and environment. Exported and returning an
 * exit code so a test can drive it; it never calls `process.exit`.
 */
export const run = async (
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> => {
  try {
    return await execute(argv, env)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Purge failed: ${message}`)
    if (message.includes('no such table')) {
      // Both ways, because this runs in both places: the image has no `db:migrate`, and
      // does not need one, since the server applies its migrations at boot.
      console.error(
        'The database has no schema yet. Start the server once, which applies the ' +
          'migrations, or run `npm run db:migrate` from a source checkout.',
      )
    }
    return 1
  }
}

/** Run as a program, and not when a test imports `run` (see `backup.ts`). */
if (require.main === module) {
  void run(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
