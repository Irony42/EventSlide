import type { Clock } from '../application/ports/clock'
import type { Logger } from '../application/ports/logger'
import type {
  ApplyEventSchedules,
  ApplyEventSchedulesReport,
} from '../application/usecases/events/applyEventSchedules'

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

export type ScheduleSweepOutcome =
  | { readonly status: 'completed'; readonly report: ApplyEventSchedulesReport }
  /** A sweep was already running. Nothing was attempted. */
  | { readonly status: 'skipped' }
  /** The sweep itself threw — a closed or locked database, not one bad event. */
  | { readonly status: 'failed'; readonly error: unknown }

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
  let timer: NodeJS.Timeout | null = null

  /**
   * The overlap guard.
   *
   * The sweep is idempotent, so two overlapping runs would not corrupt anything — but
   * they would each announce the same transition on the bus, and every projector in the
   * room would refetch twice. A slow run also means the interval is too short for the
   * database, which is something an operator can fix and should be told about.
   */
  let inFlight: Promise<ApplyEventSchedulesReport> | null = null

  const runOnce = async (): Promise<ScheduleSweepOutcome> => {
    if (inFlight !== null) {
      logger.warn('schedule sweep skipped, the previous one is still running')
      return { status: 'skipped' }
    }

    const startedAt = clock.now()

    try {
      // Called inside the try, not before it: an `apply` that threw synchronously rather
      // than returning a rejected promise would otherwise skip this catch entirely and
      // leave the timer's `void runOnce()` as an unhandled rejection, which `index.ts`
      // treats as fatal. The assignment stays ahead of the first `await`, which is what
      // makes the overlap guard above see it.
      const run = apply()
      inFlight = run

      const report = await run
      const durationMs = clock.now().getTime() - startedAt.getTime()

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
        report.refused.length === 0 &&
        report.failed.length === 0
      ) {
        // Debug: at five-minute intervals this is most lines in the file, and "nothing
        // was due" is not news. The scheduling line at startup is the proof of life.
        logger.debug('schedule sweep found nothing due', { durationMs })
      }

      return { status: 'completed', report }
    } catch (error) {
      // Reaching here means the listing itself failed — the database is closed, locked
      // or gone. Caught because an unhandled rejection from a timer callback is fatal in
      // `index.ts`, and losing the whole server because one sweep could not read the
      // database is far worse than one skipped sweep.
      logger.error('schedule sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      return { status: 'failed', error }
    } finally {
      inFlight = null
    }
  }

  return {
    runOnce,

    start: () => {
      if (timer !== null) return

      timer = setInterval(() => void runOnce(), intervalMs)

      /**
       * The timer must not be what keeps the process alive, or `docker stop` waits out
       * the full interval before Node's event loop empties.
       */
      timer.unref()

      // Proof of life at boot: the difference between "scheduling is configured" and
      // "scheduling is running" is exactly this line.
      logger.info('schedule sweep scheduled', { intervalMs })
    },

    stop: () => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }

      /**
       * A sweep already running is abandoned, not awaited — and it is safe to abandon
       * because it is resumable by construction: it saves one event at a time, and an
       * event whose row was not written keeps its schedule and is picked up by the next
       * run. Waiting would hold the process open past `docker stop`'s ten-second
       * default for work the next boot does anyway.
       */
      if (inFlight !== null) {
        logger.warn('shutting down during a schedule sweep, the rest is left to the next run')
      }
    },
  }
}
