import type { Clock } from '../application/ports/clock'
import type { EventBus, Unsubscribe } from '../application/ports/eventBus'
import type { Logger } from '../application/ports/logger'
import type { DrainChannelMedia } from '../application/usecases/channels/drainChannelMedia'
import type { SweepChannelJobs } from '../application/usecases/channels/sweepChannelJobs'
import { createGuardedJob, type JobOutcome } from './guardedJob'
import { createRepeater } from './repeater'

/**
 * The thing that turns a queued message from a group into a photograph of the event (spec 27 §6).
 *
 * It follows `clipWorker.ts` and its three choices: **woken by a fact** (`channel.mediaQueued`, published by the
 * receiving side, so a photo posted at 22:03 does not wait for an interval), **draining rather than making one pass**
 * (ten friends posting at once is the normal case), and **its first pass is at startup**, which is also crash recovery:
 * a job left `running` by a process that died is invisible until something puts it back. The tick is the backstop.
 *
 * One media at a time, and the guard (`guardedJob.ts`) makes two drains impossible: the file is held in memory while
 * it is stored (20 MB at most on the public Bot API) on a box of 4 GB.
 *
 * **Every decision is elsewhere** (`drainChannelMedia`): this module owns a timer, a loop, a signal and a guard, because
 * `src/main/**` is excluded from coverage. It also sweeps the finished jobs, at most once an hour, since it is the one
 * thing that wakes up regularly.
 */

export interface ChannelWorkerDeps {
  /** One media of the queue, taken, stored and answered. */
  readonly drainOne: DrainChannelMedia
  /** Crash recovery, run once before the first drain: puts back what a dead process left `running`. */
  readonly recover: () => Promise<number>
  /** Forgets the jobs that are over; asked at most once per {@link ChannelWorkerDeps.sweepEveryMs}. */
  readonly sweep: SweepChannelJobs
  readonly bus: EventBus
  readonly logger: Logger
  readonly clock: Clock
  /** The backstop tick. A drain normally starts from the bus long before this fires. */
  readonly intervalMs: number
  /** How many media one drain takes before it yields (shutdown can interrupt a bounded pass). */
  readonly maxPerDrain?: number
  readonly sweepEveryMs?: number
}

export interface ChannelDrainReport {
  readonly stored: number
  readonly duplicate: number
  readonly refused: number
  readonly retry: number
  readonly skipped: number
}

export type ChannelDrainOutcome = JobOutcome<ChannelDrainReport>

export interface ChannelWorker {
  /** Idempotent. Recovers, drains once immediately, then on the bus and on the tick. */
  start(): void
  /** Idempotent. Stops the timer and the subscription and aborts a download in flight. */
  stop(): void
  /** One drain, now. Never rejects. */
  runOnce(): Promise<ChannelDrainOutcome>
}

const DEFAULT_MAX_PER_DRAIN = 50
const DEFAULT_SWEEP_EVERY_MS = 60 * 60 * 1000

export const createChannelWorker = ({
  drainOne,
  recover,
  sweep,
  bus,
  logger,
  clock,
  intervalMs,
  maxPerDrain = DEFAULT_MAX_PER_DRAIN,
  sweepEveryMs = DEFAULT_SWEEP_EVERY_MS,
}: ChannelWorkerDeps): ChannelWorker => {
  let unsubscribe: Unsubscribe | null = null
  let abort = new AbortController()
  let lastSweepAt: number | null = null

  const maybeSweep = async (): Promise<void> => {
    const now = clock.now().getTime()
    if (lastSweepAt !== null && now - lastSweepAt < sweepEveryMs) return
    lastSweepAt = now
    const removed = await sweep()
    if (removed > 0) logger.info('channel jobs swept', { removed })
  }

  const drain = async (): Promise<ChannelDrainReport> => {
    const report = { stored: 0, duplicate: 0, refused: 0, retry: 0, skipped: 0 }
    for (let taken = 0; taken < maxPerDrain; taken += 1) {
      if (abort.signal.aborted) break
      const outcome = await drainOne(abort.signal)
      if (outcome === 'idle') break
      report[outcome] += 1
    }
    await maybeSweep()
    return report
  }

  const job = createGuardedJob({
    logger,
    clock,
    run: drain,
    // The expected shape: the bus announces a media while the previous one is still downloading.
    onSkipped: () => logger.debug('channel drain skipped, one is already running'),
    failedMessage: 'channel drain failed',
    describe: (report, durationMs) => {
      if (report.stored + report.duplicate + report.refused + report.retry + report.skipped > 0) {
        logger.info('channel drain finished', { ...report, durationMs })
      }
    },
  })

  const repeater = createRepeater({ everyMs: intervalMs, tick: () => void job.runOnce() })

  return {
    runOnce: job.runOnce,

    start: () => {
      if (repeater.active) return
      abort = new AbortController()

      unsubscribe = bus.subscribeAll((event) => {
        if (event.type === 'channel.mediaQueued') void job.runOnce()
      })
      repeater.start()
      logger.info('channel worker started', { intervalMs, maxPerDrain })

      void (async () => {
        try {
          const recovered = await recover()
          if (recovered > 0) logger.info('channel jobs recovered', { recovered })
        } catch (error) {
          // Not fatal: the next boot recovers them, and refusing to start would strand every new media too.
          logger.error('channel worker could not recover interrupted jobs', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
        await job.runOnce()
      })()
    },

    stop: () => {
      abort.abort()
      if (unsubscribe !== null) {
        unsubscribe()
        unsubscribe = null
      }
      repeater.stop()
      if (job.running) {
        logger.warn(
          'shutting down during a channel download, it will be picked up at the next boot',
        )
      }
    },
  }
}
