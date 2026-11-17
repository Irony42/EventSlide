import type { Clock } from '../application/ports/clock'
import type { EventBus, Unsubscribe } from '../application/ports/eventBus'
import type { Logger } from '../application/ports/logger'
import type { BuildNextAlbumExport } from '../application/usecases/exports/buildNextAlbumExport'
import type { RecoverAlbumExports } from '../application/usecases/exports/recoverAlbumExports'
import type { SweepAlbumExports } from '../application/usecases/exports/sweepAlbumExports'
import { createGuardedJob, type JobOutcome } from './guardedJob'
import { createRepeater } from './repeater'

/**
 * The thing that turns a queued archive request into a verified ZIP (spec 22).
 *
 * It follows `albumBookWorker.ts` and for the same reasons: woken by a fact (an `export.changed`
 * announcement, so a host who pressed the button does not wait for a tick), it drains (one archive
 * at a time: concurrency 1 is the product decision, a write holds a core, the disk and several
 * gigabytes of reads) and its first pass is crash recovery. The tick is the backstop, and also
 * where the expiry sweep runs, because an archive that waits behind video transcodes is only looked
 * at again on a tick.
 *
 * Every decision lives in `src/application/usecases/exports`; this module owns a timer, a loop, an
 * `AbortSignal` that shutdown raises so a write in flight stops between two entries, and a guard.
 */

export interface AlbumExportWorkerDeps {
  readonly buildNext: BuildNextAlbumExport
  readonly recover: RecoverAlbumExports
  readonly sweep: SweepAlbumExports
  readonly bus: EventBus
  readonly logger: Logger
  readonly clock: Clock
  readonly intervalMs: number
  /** Archives one drain takes before it yields (default 10). */
  readonly maxPerDrain?: number
}

export interface ExportDrainReport {
  readonly sealed: number
  readonly failed: number
}

export type ExportDrainOutcome = JobOutcome<ExportDrainReport>

export interface AlbumExportWorker {
  start(): void
  stop(): void
  runOnce(): Promise<ExportDrainOutcome>
}

const DEFAULT_MAX_PER_DRAIN = 10

export const createAlbumExportWorker = ({
  buildNext,
  recover,
  sweep,
  bus,
  logger,
  clock,
  intervalMs,
  maxPerDrain = DEFAULT_MAX_PER_DRAIN,
}: AlbumExportWorkerDeps): AlbumExportWorker => {
  let unsubscribe: Unsubscribe | null = null
  let controller = new AbortController()

  const drain = async (): Promise<ExportDrainReport> => {
    let sealed = 0
    let failed = 0
    for (let taken = 0; taken < maxPerDrain; taken += 1) {
      if (controller.signal.aborted) break
      const outcome = await buildNext(controller.signal)
      // Idle: nothing queued. Waiting: behind a video transcode, the tick looks again.
      if (outcome.kind === 'idle' || outcome.kind === 'waiting' || outcome.kind === 'aborted') break
      if (outcome.kind === 'sealed') sealed += 1
      else if (outcome.kind === 'failed') failed += 1
    }
    // The expiry sweep rides the same guard, so it never runs beside a write.
    if (!controller.signal.aborted) await sweep()
    return { sealed, failed }
  }

  const job = createGuardedJob({
    logger,
    clock,
    run: drain,
    onSkipped: () => logger.debug('archive drain skipped, one is already running'),
    failedMessage: 'archive drain failed',
    describe: (report, durationMs) => {
      if (report.sealed > 0 || report.failed > 0) {
        logger.info('archive drain finished', { ...report, durationMs })
      }
    },
  })

  const repeater = createRepeater({ everyMs: intervalMs, tick: () => void job.runOnce() })

  return {
    runOnce: job.runOnce,

    start: () => {
      if (repeater.active) return
      controller = new AbortController()
      unsubscribe = bus.subscribeAll((event) => {
        if (event.type === 'export.changed') void job.runOnce()
      })
      repeater.start()
      logger.info('album archive worker started', { intervalMs, maxPerDrain })

      void (async () => {
        try {
          await recover()
        } catch (error) {
          logger.error('album archive worker could not recover interrupted archives', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
        await job.runOnce()
      })()
    },

    stop: () => {
      controller.abort()
      if (unsubscribe !== null) {
        unsubscribe()
        unsubscribe = null
      }
      repeater.stop()
      if (job.running) {
        logger.warn('shutting down during an archive write, it will be requeued at the next boot')
      }
    },
  }
}
