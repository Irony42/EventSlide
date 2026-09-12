import type { Clock } from '../application/ports/clock'
import type { EventBus, Unsubscribe } from '../application/ports/eventBus'
import type { Logger } from '../application/ports/logger'
import type { RecoverClipJobs } from '../application/usecases/clips/recoverClipJobs'
import type { TranscodeNextClip } from '../application/usecases/clips/transcodeNextClip'

/**
 * The thing that actually turns a queued clip into a photo.
 *
 * It follows `retentionSweeper.ts` and `scheduleSweeper.ts` — a separate module in
 * `src/main` with `start`/`stop`/`runOnce`, an injected clock and logger, an overlap
 * guard, and an `unref`'d timer — and diverges from them on exactly three points, each
 * for a reason that is about a guest standing in a room:
 *
 * 1. **It is woken by a fact, not only by a tick.** A clip uploaded at 22:03 must not
 *    wait for the next tick of an interval sized for an idle evening, so the worker
 *    subscribes to the bus and a `clip.queued` announcement starts a drain. The tick
 *    stays as the backstop: an announcement can be missed (a bus with no subscriber at
 *    the instant of the publish, a drain that was already finishing) and a queue that
 *    only ever moves on a fact would stall silently.
 * 2. **It drains rather than making one pass.** A sweep asks "what is due" once an hour;
 *    this asks "what is next" until there is nothing, because ten guests filming the
 *    first dance is the normal case and one clip per interval would be a queue that
 *    never empties.
 * 3. **Its first pass is at startup**, and that first pass is also crash recovery: a row
 *    left `running` by a process that died is invisible to everything until something
 *    puts it back.
 *
 * **Every decision is somewhere else.** Which failures come back, how long the backoff
 * is, what counts as abandoned, whether a clip fits the quota: all of it is in
 * `src/domain/clips` and `src/application/usecases/clips`, because `src/main/**` is
 * excluded from coverage and a rule nothing can test is a rule nobody can change safely.
 * This module owns a timer, a loop, and a guard.
 */

export interface ClipWorkerDeps {
  /** One pass of the queue. Injected as a function, so a test needs no repository. */
  readonly transcodeNext: TranscodeNextClip
  /** Crash recovery, run once before the first drain. */
  readonly recover: RecoverClipJobs
  readonly bus: EventBus
  readonly logger: Logger
  /** For the duration in the log line. Injected so that duration is assertable. */
  readonly clock: Clock
  /** The backstop tick. A drain normally starts from the bus long before this fires. */
  readonly intervalMs: number
  /**
   * How many clips one drain will take before it yields.
   *
   * A bound rather than "until empty", so a queue that is being refilled as fast as it is
   * drained cannot hold the loop forever — the timer and the next announcement both pick
   * it up again immediately, and a bounded pass is one that shutdown can interrupt.
   */
  readonly maxPerDrain?: number
}

export interface DrainReport {
  readonly transcoded: number
  readonly failed: number
}

export type DrainOutcome =
  | { readonly status: 'completed'; readonly report: DrainReport }
  /** A drain was already running. Nothing was attempted. */
  | { readonly status: 'skipped' }
  /** The pass itself threw — a closed or locked database, not a bad clip. */
  | { readonly status: 'failed'; readonly error: unknown }

export interface ClipWorker {
  /** Idempotent. Recovers, drains once immediately, then on the bus and on the tick. */
  start(): void
  /** Idempotent. Stops the timer and the subscription; abandons a drain in flight. */
  stop(): void
  /** One drain, now. Never rejects. */
  runOnce(): Promise<DrainOutcome>
}

const DEFAULT_MAX_PER_DRAIN = 50

export const createClipWorker = ({
  transcodeNext,
  recover,
  bus,
  logger,
  clock,
  intervalMs,
  maxPerDrain = DEFAULT_MAX_PER_DRAIN,
}: ClipWorkerDeps): ClipWorker => {
  let timer: NodeJS.Timeout | null = null
  let unsubscribe: Unsubscribe | null = null
  let stopping = false

  /**
   * The overlap guard, and here it is not merely tidiness.
   *
   * Two drains would each claim a job — the claim is atomic, so they would not fight over
   * one — and then run two encoders at once on a box whose whole design assumes one. The
   * wall drops frames, and the guest whose clip is second waits longer than if they had
   * queued. Concurrency 1 is the product decision; this is what enforces it.
   */
  let inFlight: Promise<DrainReport> | null = null

  const drain = async (): Promise<DrainReport> => {
    let transcoded = 0
    let failed = 0

    for (let taken = 0; taken < maxPerDrain; taken += 1) {
      if (stopping) break

      const outcome = await transcodeNext()
      if (!outcome.ok) {
        // A `Result` failure here is a transition the entity refused, which means a
        // repository handed back something impossible. Logged and the drain stops: the
        // next pass will meet the same row, and hammering it would fill a log instead.
        logger.error('clip worker could not complete a pass', { code: outcome.error.code })
        break
      }

      if (outcome.value.kind === 'idle') break
      if (outcome.value.kind === 'transcoded') transcoded += 1
      else failed += 1
    }

    return { transcoded, failed }
  }

  const runOnce = async (): Promise<DrainOutcome> => {
    if (inFlight !== null) {
      // Debug rather than a warning, unlike the sweeps: a drain overlapping a wake-up is
      // the *expected* shape here — the bus announces a clip while the previous one is
      // still encoding, several times an evening — and a warning per upload would be
      // noise an operator learns to ignore.
      logger.debug('clip drain skipped, one is already running')
      return { status: 'skipped' }
    }

    const startedAt = clock.now()

    try {
      // Called inside the try, not before it: a `transcodeNext` that threw synchronously
      // rather than returning a rejected promise would otherwise skip this catch and
      // leave the timer's `void runOnce()` as an unhandled rejection, which `index.ts`
      // treats as fatal. The assignment stays ahead of the first `await`, which is what
      // makes the overlap guard above see it.
      const run = drain()
      inFlight = run

      const report = await run
      const durationMs = clock.now().getTime() - startedAt.getTime()

      if (report.transcoded > 0 || report.failed > 0) {
        logger.info('clip drain finished', {
          transcoded: report.transcoded,
          failed: report.failed,
          durationMs,
        })
      }

      return { status: 'completed', report }
    } catch (error) {
      // The use case swallows a per-clip failure by design, so reaching here means the
      // database is closed, locked or gone. Caught because an unhandled rejection from a
      // timer callback is fatal in `index.ts`, and losing the whole server because one
      // clip could not be read would be a far worse outcome than a skipped drain.
      logger.error('clip drain failed', {
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
      stopping = false

      /**
       * Every event's activity, which is the one subscription in the product that is not
       * scoped to an event — there is one queue for the box, and the worker cannot name
       * the event whose guest is about to upload.
       *
       * The listener does no work of its own: it starts a drain and returns, because the
       * bus delivers synchronously on the publishing request's stack and a slow
       * subscriber there would be a slow upload for the guest who caused it.
       */
      unsubscribe = bus.subscribeAll((event) => {
        if (event.type !== 'clip.queued') return
        void runOnce()
      })

      timer = setInterval(() => void runOnce(), intervalMs)

      /**
       * The timer must not be what keeps the process alive.
       *
       * Without this, `docker stop` waits out the full interval before Node's event loop
       * empties, and the shutdown backstop in `index.ts` never gets to do its job because
       * the process is not trying to exit in the first place.
       */
      timer.unref()

      logger.info('clip worker started', { intervalMs, maxPerDrain })

      /**
       * Recovery, then the first drain — **now**, not one interval from now.
       *
       * This is the opposite of what the two sweeps do, and deliberately: a restart must
       * not begin deleting albums while the party is uploading, but a restart that leaves
       * a guest's clip sitting in a queue for an interval has simply lost their clip for
       * that long. A row still marked `running` is invisible to everything until this
       * puts it back, so recovery has to be first and has to be here.
       */
      void (async () => {
        try {
          await recover()
        } catch (error) {
          // Not fatal: an unrecovered job is picked up by the next boot, and refusing to
          // start the worker over it would strand every *new* clip as well.
          logger.error('clip worker could not recover interrupted jobs', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
        await runOnce()
      })()
    },

    stop: () => {
      stopping = true

      if (unsubscribe !== null) {
        unsubscribe()
        unsubscribe = null
      }
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }

      /**
       * A drain in flight is abandoned, not awaited — the same call the sweeps make, and
       * safe for the same reason: the work is resumable by construction. The clip being
       * encoded is `running`, so the next boot's recovery puts it back; the ones behind
       * it are still `queued`.
       *
       * What is **not** left to chance is the encoder itself. A container stop orphans a
       * child rather than stopping it, so the transcoder's own `close()` — called from
       * `container.dispose()` beside this — sends SIGTERM and then SIGKILL to every
       * ffmpeg still running. Without that, a new container starts the same job while the
       * old one holds a core for the rest of the evening.
       */
      if (inFlight !== null) {
        logger.warn('shutting down during a clip transcode, it will be picked up at the next boot')
      }
    },
  }
}
