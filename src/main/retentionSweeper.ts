import type { Clock } from '../application/ports/clock'
import type { Logger } from '../application/ports/logger'
import type {
  PurgeExpiredEvents,
  PurgeExpiredEventsReport,
} from '../application/usecases/events/purgeExpiredEvents'

/**
 * The trigger the retention setting never had.
 *
 * `purgeExpiredEvents` has been complete and tested since the use case was written, and
 * nothing called it: a host who set "delete after 30 days" was told their guests' photos
 * would go away, and they did not. This is the timer, and `scripts/purge.ts` is the same
 * sweep on demand.
 *
 * It lives in `src/main` because the composition root is the only layer allowed to own a
 * timer — but it is a separate module, not four lines inside `container.ts`, because
 * everything below is a decision that can be wrong in a way an operator only discovers
 * after an album is gone. A `setInterval` in the composition root would be untestable by
 * construction; this takes a clock and a sweep function and is driven entirely from a
 * test.
 *
 * What it deliberately does **not** do is decide anything about retention. Which events
 * are due, what order they are deleted in, and what a failure means are the use case's
 * and the entity's business. This schedules, guards and reports.
 */

export interface RetentionSweeperDeps {
  /** The use case. Injected as a function so a test needs no repository at all. */
  readonly purge: PurgeExpiredEvents
  readonly logger: Logger
  /** For the duration in the log line. Injected so that duration is assertable. */
  readonly clock: Clock
  readonly intervalMs: number
}

export type SweepOutcome =
  | { readonly status: 'completed'; readonly report: PurgeExpiredEventsReport }
  /** A sweep was already running. Nothing was attempted. */
  | { readonly status: 'skipped' }
  /** The sweep itself threw — a closed or locked database, not a busy disk. */
  | { readonly status: 'failed'; readonly error: unknown }

export interface RetentionSweeper {
  /** Idempotent. The first sweep happens one interval from now, never at startup. */
  start(): void
  /** Idempotent. Stops the timer; does not wait for a sweep already in flight. */
  stop(): void
  /** One sweep, now. Never rejects. */
  runOnce(): Promise<SweepOutcome>
}

export const createRetentionSweeper = ({
  purge,
  logger,
  clock,
  intervalMs,
}: RetentionSweeperDeps): RetentionSweeper => {
  let timer: NodeJS.Timeout | null = null

  /**
   * The overlap guard.
   *
   * A sweep is a series of recursive directory removals. Two of them over the same event
   * is how you get half a media root and a report that contradicts itself — one run
   * deleting the tree out from under the other, both then failing to delete the row, and
   * an operator reading two `failed` lists for an event that is in fact half gone. A
   * slow sweep is the normal case, not the exceptional one: forty albums on a spinning
   * disk on a machine that is also serving a live event can easily outlast an hour.
   */
  let inFlight: Promise<PurgeExpiredEventsReport> | null = null

  const runOnce = async (): Promise<SweepOutcome> => {
    if (inFlight !== null) {
      // Worth a warning rather than silence: it means the sweep no longer fits in its
      // interval, which an operator can fix by lengthening it.
      logger.warn('retention sweep skipped, the previous one is still running')
      return { status: 'skipped' }
    }

    const startedAt = clock.now()

    try {
      // Called inside the try, not before it: a `purge` that threw synchronously rather
      // than returning a rejected promise would otherwise skip this catch entirely and
      // leave the timer's `void runOnce()` as an unhandled rejection, which `index.ts`
      // treats as fatal. The assignment stays ahead of the first `await`, which is what
      // makes the overlap guard above see it.
      const run = purge()
      inFlight = run

      const report = await run
      const durationMs = clock.now().getTime() - startedAt.getTime()

      // Three independent lines, because the mixed case is real: a run that purged
      // thirty-nine albums and could not purge the fortieth has to report both.
      if (report.purged.length > 0) {
        logger.info('retention sweep purged expired events', {
          purged: report.purged.length,
          // The ids, not just the count: this is the only record that these albums
          // existed, and after this line there is nothing left to look them up in.
          purgedIds: report.purged.join(' '),
          durationMs,
        })
      }
      if (report.failed.length > 0) {
        // An error, not a warning. Photos a host promised to delete are still on disk,
        // and these ids are the only signal an operator gets that a disk is wedged. The
        // next sweep retries them, which is why this is not fatal.
        logger.error('retention sweep could not purge every expired event', {
          failed: report.failed.length,
          failedIds: report.failed.join(' '),
          durationMs,
        })
      }
      if (report.purged.length === 0 && report.failed.length === 0) {
        // Debug: at an hourly interval this is most lines in the file, and "nothing was
        // due" is not news. The scheduling line at startup is the proof of life.
        logger.debug('retention sweep found nothing to purge', { durationMs })
      }

      return { status: 'completed', report }
    } catch (error) {
      // The use case swallows a per-event failure by design, so reaching here means the
      // listing itself failed — the database is closed, locked or gone. Caught because
      // an unhandled rejection from a timer callback is fatal in `index.ts`, and losing
      // the whole server because a purge could not read the database would be a far
      // worse outcome than one skipped sweep.
      logger.error('retention sweep failed', {
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
       * The timer must not be what keeps the process alive.
       *
       * Without this, `docker stop` waits out the full interval — up to a day — before
       * Node's event loop empties, and the 15 s shutdown backstop in `index.ts` never
       * gets to do its job because the process is not trying to exit in the first place.
       */
      timer.unref()

      // Proof of life at boot, and the value an operator has to change if the skip
      // warning above ever appears.
      logger.info('retention sweep scheduled', { intervalMs })
    },

    stop: () => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }

      /**
       * A sweep already running is abandoned, not awaited.
       *
       * It is safe to abandon because the sweep is resumable by construction: it deletes
       * media then the row, one event at a time, so an interrupted event is one whose
       * row still exists — `listDueForPurge` returns it again next time, and
       * `MediaStore.deleteEvent` is idempotent and safe on an event that stored nothing,
       * so the retry finishes the half-removed directory rather than tripping over it.
       * Nothing is lost that was not already promised to be deleted.
       *
       * Waiting, by contrast, would hold the process open past `docker stop`'s ten
       * second default while forty recursive deletions finish, and the container would
       * then be SIGKILLed mid-sweep anyway — the same interruption, minus the graceful
       * shutdown, minus the WAL checkpoint that makes the database file copyable. So the
       * choice is not "finish or abandon", it is "abandon now, in a controlled place, or
       * abandon later at an arbitrary one".
       */
      if (inFlight !== null) {
        logger.warn('shutting down during a retention sweep, the rest is left to the next run')
      }
    },
  }
}
