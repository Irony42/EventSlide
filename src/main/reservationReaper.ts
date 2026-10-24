import type { Clock } from '../application/ports/clock'
import type { Logger } from '../application/ports/logger'
import type {
  ReapStaleReservations,
  ReapStaleReservationsReport,
} from '../application/usecases/clips/reapStaleReservations'
import { createGuardedJob, type JobOutcome } from './guardedJob'
import { createRepeater } from './repeater'

/**
 * The timer behind the reservation reaper.
 *
 * **It exists because the use case had exactly one caller and that caller runs once.**
 * Crash recovery reaped reservations at process start, which sounds like the right moment
 * and is the one moment it cannot work: a box OOM-killed mid-upload is back in seconds,
 * the stranded row is ten seconds old, the five-minute window correctly spares it — and
 * nothing asked again until the next restart. On a box booted at 18:00 and running to
 * 02:00 that row charged its event for bytes that do not exist, held one of twenty global
 * queue slots, and answered its guest `202 reserved` about a job that would never move,
 * all night.
 *
 * So it runs on a short interval, and the age guard is unchanged: a periodic pass turns
 * "never" into "five minutes later", which is the difference between a wedged evening and
 * a blip.
 *
 * It is a separate timer from the clip worker's rather than a step inside the drain,
 * because the two have different periods and different failure modes — a drain is woken
 * by every upload and bounded by an encoder, this is a single indexed delete on a fixed
 * cadence — and folding them would make the worker's overlap guard decide how often a
 * reservation is reaped.
 *
 * As with the other sweepers, everything that can be decided is decided in the use case:
 * this schedules, guards against overlap, and reports.
 */

export interface ReservationReaperDeps {
  /** The use case. Injected as a function so a test needs no repository. */
  readonly reap: ReapStaleReservations
  readonly logger: Logger
  /** For the duration in the log line. Injected so that duration is assertable. */
  readonly clock: Clock
  readonly intervalMs: number
}

export type ReapOutcome = JobOutcome<ReapStaleReservationsReport>

export interface ReservationReaper {
  /** Idempotent. Reaps once at startup, then on the interval. */
  start(): void
  /** Idempotent. Stops the timer; does not wait for a pass already in flight. */
  stop(): void
  /** One pass, now. Never rejects. */
  runOnce(): Promise<ReapOutcome>
}

export const createReservationReaper = ({
  reap,
  logger,
  clock,
  intervalMs,
}: ReservationReaperDeps): ReservationReaper => {
  // The overlap guard, the catch that keeps a failed pass from becoming an unhandled
  // rejection (fatal in `index.ts`) and the duration are `createGuardedJob`'s. The guard
  // here is about not asking a busy database twice for the same answer rather than about
  // correctness: a second pass would find nothing the first had not taken, because the
  // delete is transactional.
  const job = createGuardedJob({
    logger,
    clock,
    run: reap,
    onSkipped: () => logger.debug('reservation reap skipped, one is already running'),
    failedMessage: 'reservation reap failed',
    describe: (report, durationMs) => {
      if (report.reaped > 0) {
        logger.info('reaped clip reservations left by requests that died', {
          reaped: report.reaped,
          durationMs,
        })
      } else {
        // Debug: a healthy box reaps nothing every five minutes for ever, and that is
        // most of a log file.
        logger.debug('no stale clip reservations to reap', { durationMs })
      }
    },
  })

  const repeater = createRepeater({ everyMs: intervalMs, tick: () => void job.runOnce() })

  return {
    runOnce: job.runOnce,

    start: () => {
      if (repeater.active) return

      repeater.start()

      logger.info('reservation reaper scheduled', { intervalMs })

      /**
       * And a pass **now**, unlike the two sweeps.
       *
       * A restart is when wreckage is likeliest — the reservation this exists for was
       * stranded by whatever killed the last process — and reaping one is not destructive
       * in the way a retention purge is: the age guard is what protects a
       * `--force-recreate` overlap, and it applies to this pass exactly as it does to
       * every later one.
       */
      void job.runOnce()
    },

    stop: () => {
      repeater.stop()

      /**
       * A pass in flight is abandoned, not awaited. It is one transactional delete: it
       * either committed or it did not, and the next boot's startup pass asks the same
       * question again.
       */
      if (job.running) {
        logger.debug('shutting down during a reservation reap, the next boot asks again')
      }
    },
  }
}
