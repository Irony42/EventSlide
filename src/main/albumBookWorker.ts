import type { Clock } from '../application/ports/clock'
import type { EventBus, Unsubscribe } from '../application/ports/eventBus'
import type { Logger } from '../application/ports/logger'
import type { BuildNextAlbumBook } from '../application/usecases/book/buildNextAlbumBook'
import type { RecoverAlbumBooks } from '../application/usecases/book/recoverAlbumBooks'
import type { SweepAlbumBooks } from '../application/usecases/book/sweepAlbumBooks'
import { createGuardedJob, type JobOutcome } from './guardedJob'
import { createRepeater } from './repeater'

/**
 * The thing that turns a queued photo book into a PDF (spec 04).
 *
 * It follows `clipWorker.ts` and diverges on the same three points: woken by a fact (a
 * `book.changed` announcement, so a host who pressed the button does not wait for a tick), it
 * drains (one book at a time: concurrency 1 is the product decision, a render holds a core and
 * a lot of memory) and its first pass is crash recovery. The tick is the backstop, and also
 * where the expiry sweep runs, because a book that waits behind video transcodes is only
 * looked at again on a tick.
 *
 * Every decision lives in `src/application/usecases/book`; this module owns a timer, a loop,
 * an `AbortSignal` that shutdown raises so a render in flight stops between two photographs,
 * and a guard.
 */

export interface AlbumBookWorkerDeps {
  readonly buildNext: BuildNextAlbumBook
  readonly recover: RecoverAlbumBooks
  readonly sweep: SweepAlbumBooks
  readonly bus: EventBus
  readonly logger: Logger
  readonly clock: Clock
  readonly intervalMs: number
  /** Books one drain takes before it yields (default 10). */
  readonly maxPerDrain?: number
}

export interface BookDrainReport {
  readonly built: number
  readonly failed: number
}

export type BookDrainOutcome = JobOutcome<BookDrainReport>

export interface AlbumBookWorker {
  start(): void
  stop(): void
  runOnce(): Promise<BookDrainOutcome>
}

const DEFAULT_MAX_PER_DRAIN = 10

export const createAlbumBookWorker = ({
  buildNext,
  recover,
  sweep,
  bus,
  logger,
  clock,
  intervalMs,
  maxPerDrain = DEFAULT_MAX_PER_DRAIN,
}: AlbumBookWorkerDeps): AlbumBookWorker => {
  let unsubscribe: Unsubscribe | null = null
  let controller = new AbortController()

  const drain = async (): Promise<BookDrainReport> => {
    let built = 0
    let failed = 0
    for (let taken = 0; taken < maxPerDrain; taken += 1) {
      if (controller.signal.aborted) break
      const outcome = await buildNext(controller.signal)
      // Idle: nothing queued. Waiting: behind a video transcode, the tick looks again.
      if (outcome.kind === 'idle' || outcome.kind === 'waiting' || outcome.kind === 'aborted') break
      if (outcome.kind === 'built') built += 1
      else if (outcome.kind === 'failed') failed += 1
    }
    // The expiry sweep rides the same guard, so it never runs beside a render.
    if (!controller.signal.aborted) await sweep()
    return { built, failed }
  }

  const job = createGuardedJob({
    logger,
    clock,
    run: drain,
    onSkipped: () => logger.debug('book drain skipped, one is already running'),
    failedMessage: 'book drain failed',
    describe: (report, durationMs) => {
      if (report.built > 0 || report.failed > 0) {
        logger.info('book drain finished', { ...report, durationMs })
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
        if (event.type === 'book.changed') void job.runOnce()
      })
      repeater.start()
      logger.info('album book worker started', { intervalMs, maxPerDrain })

      void (async () => {
        try {
          await recover()
        } catch (error) {
          logger.error('album book worker could not recover interrupted books', {
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
        logger.warn('shutting down during a book render, it will be requeued at the next boot')
      }
    },
  }
}
