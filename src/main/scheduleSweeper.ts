import type { Clock } from '../application/ports/clock'
import type { Logger } from '../application/ports/logger'
import type {
  ApplyEventSchedules,
  ApplyEventSchedulesReport,
} from '../application/usecases/events/applyEventSchedules'
import { createGuardedJob, type JobOutcome } from './guardedJob'
import { createRepeater } from './repeater'

/**
 * The timer behind "opens at 18:00, closes at 02:00".
 *
 * Deliberately the same shape as `./retentionSweeper.ts`, down to the overlap guard and
 * the `unref()`, because the two failure modes are the same: a sweep that stops firing
 * is invisible — its symptom is that nothing happens — and a timer that keeps the event
 * loop alive makes `docker stop` wait out a whole interval.
 *
 * It lives in `src/main` because the composition root is the only layer allowed to own
 * a timer, and it is a module rather than four lines inside `container.ts` because a
 * `setInterval` in the composition root is untestable by construction. This takes a
 * clock and a sweep function and is driven entirely from a test.
 *
 * What it does **not** decide is anything about the schedule. Which events are due,
 * whether the lifecycle accepts the transition, and what happens to an instant that has
 * been acted on belong to `applyEventSchedules` and to the `Event` aggregate. This
 * schedules, guards and reports.
 */

export interface ScheduleSweeperDeps {
  /** The use case. Injected as a function so a test needs no repository at all. */
  readonly apply: ApplyEventSchedules
  readonly logger: Logger
  /** For the duration in the log line. Injected so that duration is assertable. */
  readonly clock: Clock
  readonly intervalMs: number
}

export type ScheduleSweepOutcome = JobOutcome<ApplyEventSchedulesReport>

export interface ScheduleSweeper {
  /** Idempotent. The first sweep happens one interval from now, never at startup. */
  start(): void
  /** Idempotent. Stops the timer; does not wait for a sweep already in flight. */
  stop(): void
  /** One sweep, now. Never rejects. */
  runOnce(): Promise<ScheduleSweepOutcome>
}

export const createScheduleSweeper = ({
  apply,
  logger,
  clock,
  intervalMs,
}: ScheduleSweeperDeps): ScheduleSweeper => {
  /**
   * The sweep is idempotent, so two overlapping runs would not corrupt anything — but they
   * would each announce the same transition on the bus, and every projector in the room
   * would refetch twice. A slow run also means the interval is too short for the database,
   * which is something an operator can fix and should be told about, hence a warning.
   *
   * The guard, the catch (an `apply` that threw synchronously must not leave the timer's
   * `void runOnce()` as an unhandled rejection, which `index.ts` treats as fatal) and the
   * duration are `createGuardedJob`'s.
   */
  const job = createGuardedJob({
    logger,
    clock,
    run: apply,
    onSkipped: () => logger.warn('schedule sweep skipped, the previous one is still running'),
    // Reaching the catch means the listing itself failed — the database is closed, locked
    // or gone — and losing the whole server over one sweep that could not read it is far
    // worse than one skipped sweep.
    failedMessage: 'schedule sweep failed',
    describe: (report, durationMs) => {
      if (report.opened.length > 0 || report.closed.length > 0) {
        // Info, and with the ids: "why did the wall go dark at 02:00" has exactly one
        // answer, and this line is it.
        logger.info('schedule sweep moved events', {
          opened: report.opened.length,
          openedIds: report.opened.join(' '),
          closed: report.closed.length,
          closedIds: report.closed.join(' '),
          durationMs,
        })
      }
      if (report.autoClosed.length > 0) {
        // Info, and with the ids, for the same reason as above and a different cause: the
        // wall went dark because a client's live window ran out, not because a host asked.
        // The audit entry and the e-mail to the host (roadmap §10.8) hang off this list.
        logger.info('schedule sweep closed events whose client live window ran out', {
          autoClosed: report.autoClosed.length,
          autoClosedIds: report.autoClosed.join(' '),
          durationMs,
        })
      }
      if (report.refused.length > 0) {
        // A warning rather than an error: the lifecycle did its job — an archived event
        // did not reopen — but a host configured something that will now never happen,
        // and the instant has been discarded, so this line is the only record of it.
        logger.warn('schedule sweep discarded a transition the lifecycle refused', {
          refused: report.refused.length,
          refusedIds: report.refused.join(' '),
        })
      }
      if (report.failed.length > 0) {
        // An error: an event a host was promised would open is still shut. The next
        // sweep retries it, which is why this is not fatal.
        logger.error('schedule sweep could not write every event', {
          failed: report.failed.length,
          failedIds: report.failed.join(' '),
        })
      }
      if (
        report.opened.length === 0 &&
        report.closed.length === 0 &&
        report.autoClosed.length === 0 &&
        report.refused.length === 0 &&
        report.failed.length === 0
      ) {
        // Debug: at five-minute intervals this is most lines in the file, and "nothing
        // was due" is not news. The scheduling line at startup is the proof of life.
        logger.debug('schedule sweep found nothing due', { durationMs })
      }
    },
  })

  const repeater = createRepeater({ everyMs: intervalMs, tick: () => void job.runOnce() })

  return {
    runOnce: job.runOnce,

    start: () => {
      if (repeater.active) return

      repeater.start()

      // Proof of life at boot: the difference between "scheduling is configured" and
      // "scheduling is running" is exactly this line.
      logger.info('schedule sweep scheduled', { intervalMs })
    },

    stop: () => {
      repeater.stop()

      /**
       * A sweep already running is abandoned, not awaited — and it is safe to abandon
       * because it is resumable by construction: it saves one event at a time, and an
       * event whose row was not written keeps its schedule and is picked up by the next
       * run. Waiting would hold the process open past `docker stop`'s ten-second
       * default for work the next boot does anyway.
       */
      if (job.running) {
        logger.warn('shutting down during a schedule sweep, the rest is left to the next run')
      }
    },
  }
}
