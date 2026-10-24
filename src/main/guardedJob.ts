import type { Clock } from '../application/ports/clock'
import type { Logger } from '../application/ports/logger'

/**
 * One pass of a background job, guarded.
 *
 * The retention sweep, the schedule sweep, the media reconciliation, the reservation reaper
 * and the clip worker's drain each used to carry their own copy of this: an overlap guard, a
 * `try` that catches a pass that threw, a duration, and a `finally` that lowers the guard.
 * What differs between them is what a pass does and what it says about what it found, and
 * that is all a job passes in.
 *
 * **It never rejects**, even when `run` throws synchronously rather than returning a
 * rejected promise: a timer callback that rejected would be an unhandled rejection, which is
 * fatal in `index.ts`, and losing the server because one pass could not read the database is
 * far worse than one skipped pass. So `run` is called inside the `try`, and the guard is
 * raised before anything that can throw or await, which is what makes a second tick see it.
 */

export type JobOutcome<Report> =
  | { readonly status: 'completed'; readonly report: Report }
  /** A pass was already running. Nothing was attempted. */
  | { readonly status: 'skipped' }
  /** The pass itself threw: a closed or locked database, not one bad row. */
  | { readonly status: 'failed'; readonly error: unknown }

export interface GuardedJobDeps<Report> {
  readonly logger: Logger
  /** For the duration the report is given. Injected so that duration is assertable. */
  readonly clock: Clock
  /** The pass. Called inside the guard's `try`. */
  readonly run: () => Promise<Report>
  /** What the pass found, said at the levels the job chooses. Throwing here fails the pass. */
  readonly describe: (report: Report, durationMs: number) => void
  /** Said when a pass is asked for while one is running. Each job picks its level. */
  readonly onSkipped: () => void
  /** The error line when the pass itself throws, which carries the error's message. */
  readonly failedMessage: string
  /**
   * Work that belongs inside the guard but after the pass, whatever became of it: the
   * retention sweep prunes the audit log here, and a second tick must not start a sweep
   * while that is still running. It must not throw, since it runs in a `finally` where a
   * throw would replace the pass's own outcome.
   */
  readonly afterwards?: () => Promise<void>
}

export interface GuardedJob<Report> {
  /** One pass, now. Never rejects. */
  runOnce(): Promise<JobOutcome<Report>>
  /** Whether a pass is in flight, for the line a job says when it is stopped mid-pass. */
  readonly running: boolean
}

export const createGuardedJob = <Report>({
  logger,
  clock,
  run,
  describe,
  onSkipped,
  failedMessage,
  afterwards,
}: GuardedJobDeps<Report>): GuardedJob<Report> => {
  let running = false

  const runOnce = async (): Promise<JobOutcome<Report>> => {
    if (running) {
      onSkipped()
      return { status: 'skipped' }
    }

    running = true

    try {
      const startedAt = clock.now()
      const report = await run()
      describe(report, clock.now().getTime() - startedAt.getTime())
      return { status: 'completed', report }
    } catch (error) {
      logger.error(failedMessage, {
        error: error instanceof Error ? error.message : String(error),
      })
      return { status: 'failed', error }
    } finally {
      // Not `await afterwards?.()`: that awaits `undefined` when there is none, which costs
      // every job a microtask the five originals did not spend.
      if (afterwards !== undefined) await afterwards()
      running = false
    }
  }

  return {
    runOnce,
    get running(): boolean {
      return running
    },
  }
}
