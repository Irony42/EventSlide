import type { Clock } from '../application/ports/clock'
import type { EventBus, Unsubscribe } from '../application/ports/eventBus'
import type { Logger } from '../application/ports/logger'
import type { RecoverReels } from '../application/usecases/highlights/recoverReels'
import type { TranscodeNextReel } from '../application/usecases/highlights/transcodeNextReel'
import type { RecoverClipJobs } from '../application/usecases/clips/recoverClipJobs'
import type { TranscodeNextClip } from '../application/usecases/clips/transcodeNextClip'
import type { RecoverVoiceJobs } from '../application/usecases/guestbook/recoverVoiceJobs'
import type { TranscodeNextVoice } from '../application/usecases/guestbook/transcodeNextVoice'
import { createGuardedJob, type JobOutcome } from './guardedJob'
import { createRepeater } from './repeater'

/**
 * The thing that actually turns a queued clip into a photo.
 *
 * It follows `retentionSweeper.ts` and `scheduleSweeper.ts` — a separate module in
 * `src/main` with `start`/`stop`/`runOnce`, an injected clock and logger, an overlap
 * guard (`guardedJob.ts`) and an `unref`'d timer (`repeater.ts`) — and diverges from them on
 * exactly three points, each
 * for a reason that is about a guest standing in a room:
 *
 * 1. **It is woken by a fact, not only by a tick.** A clip uploaded at 22:03 must not
 *    wait for the next tick of an interval sized for an idle evening, so the worker
 *    subscribes to the bus and a `clip.queued` announcement starts a drain. The tick
 *    stays as the backstop: an announcement can be missed (a bus with no subscriber at
 *    the instant of the publish, a drain that was already finishing) and a queue that
 *    only ever moves on a fact would stall silently.
 * 2. **It drains rather than making one pass, and alternates.** A sweep asks "what is due" once an hour;
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
  /**
   * The host's highlight reel (spec 08), drained by the **same** loop: one encoder at a time on a
   * two-core box, clips first (a guest is waiting for one), a montage when no clip is due. Absent,
   * the worker is the clip worker it always was.
   */
  readonly transcodeNextReel?: TranscodeNextReel
  readonly recoverReels?: RecoverReels
  /**
   * The guestbook's voice messages (spec 25), drained by the **same** loop for the same reason:
   * one encoder at a time on a two-core box. A voice is a few hundred milliseconds of work and its
   * guest waits on "En traitement", a clip is seconds and its guest waits on "Merci", so the loop
   * **alternates** between the two (see `drain`). Absent, the worker is the clip worker it was.
   */
  readonly transcodeNextVoice?: TranscodeNextVoice
  readonly recoverVoices?: RecoverVoiceJobs
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
  /** Voice messages made ready in this drain. */
  readonly voices: number
  readonly failed: number
  /** Highlight reels made in this drain. */
  readonly rendered: number
}

export type DrainOutcome = JobOutcome<DrainReport>

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
  transcodeNextReel,
  recoverReels,
  transcodeNextVoice,
  recoverVoices,
  bus,
  logger,
  clock,
  intervalMs,
  maxPerDrain = DEFAULT_MAX_PER_DRAIN,
}: ClipWorkerDeps): ClipWorker => {
  let unsubscribe: Unsubscribe | null = null
  let stopping = false

  /** What one step of the loop found: it made progress, it found nothing due, or it must stop the drain. */
  type Pass = 'worked' | 'idle' | 'refused'
  type Step = readonly ['voice' | 'clip', () => Promise<Pass>]

  /**
   * One drain, **alternating voice and clip**, and a montage only when both are empty.
   *
   * A voice is a few hundred milliseconds of encoder and a guest waits on "En traitement"; a clip is
   * seconds and its guest waits on "Merci". Voices first would let a burst of sixty (the end of a
   * meal) hold every clip back for a minute, and `maxPerDrain` does not prevent it: it restarts from
   * zero at every drain, so a queue refilled as fast as it empties never yields. Strict alternation
   * does: whichever of the two just ran, the **other** is asked next, so a clip waits behind at most
   * one voice and a voice behind at most one clip. If the one asked has nothing due the other is
   * taken at once: an idle queue costs a single indexed read, never a turn.
   */
  const drain = async (): Promise<DrainReport> => {
    let transcoded = 0
    let voices = 0
    let failed = 0
    let rendered = 0

    const clipPass = async (): Promise<Pass> => {
      const outcome = await transcodeNext()
      if (!outcome.ok) {
        // A `Result` failure here is a transition the entity refused, which means a
        // repository handed back something impossible. Logged and the drain stops: the
        // next pass will meet the same row, and hammering it would fill a log instead.
        logger.error('clip worker could not complete a pass', { code: outcome.error.code })
        return 'refused'
      }
      if (outcome.value.kind === 'idle') return 'idle'
      if (outcome.value.kind === 'transcoded') transcoded += 1
      else failed += 1
      return 'worked'
    }

    const voicePass = async (): Promise<Pass> => {
      if (transcodeNextVoice === undefined) return 'idle'
      const outcome = await transcodeNextVoice()
      if (!outcome.ok) {
        logger.error('clip worker could not complete a voice pass', { code: outcome.error.code })
        return 'refused'
      }
      if (outcome.value.kind === 'idle') return 'idle'
      if (outcome.value.kind === 'transcoded') voices += 1
      else if (outcome.value.kind === 'failed') failed += 1
      // `retired`: erased while it ran. Progress was made (a row left the queue), nothing to count.
      return 'worked'
    }

    let voiceTurn = true

    for (let taken = 0; taken < maxPerDrain; taken += 1) {
      if (stopping) break

      const voiceStep: Step = ['voice', voicePass]
      const clipStep: Step = ['clip', clipPass]
      const steps: readonly Step[] = voiceTurn ? [voiceStep, clipStep] : [clipStep, voiceStep]
      let worked: 'voice' | 'clip' | null = null
      let refused = false
      for (const [name, pass] of steps) {
        const found = await pass()
        if (found === 'refused') {
          refused = true
          break
        }
        if (found === 'worked') {
          worked = name
          break
        }
      }
      if (refused) break
      if (worked !== null) {
        voiceTurn = worked === 'clip'
        continue
      }

      // Neither is due: one montage, then voices and clips are looked at again before the next.
      if (transcodeNextReel === undefined) break
      const reel = await transcodeNextReel()
      if (!reel.ok) {
        logger.error('clip worker could not complete a reel pass', { code: reel.error.code })
        break
      }
      if (reel.value.kind === 'idle') break
      if (reel.value.kind === 'rendered') rendered += 1
      else if (reel.value.kind === 'failed') failed += 1
    }

    return { transcoded, voices, failed, rendered }
  }

  /**
   * The overlap guard, and here it is not merely tidiness.
   *
   * Two drains would each claim a job — the claim is atomic, so they would not fight over
   * one — and then run two encoders at once on a box whose whole design assumes one. The
   * wall drops frames, and the guest whose clip is second waits longer than if they had
   * queued. Concurrency 1 is the product decision; this is what enforces it.
   */
  const job = createGuardedJob({
    logger,
    clock,
    run: drain,
    // Debug rather than a warning, unlike the sweeps: a drain overlapping a wake-up is
    // the *expected* shape here — the bus announces a clip while the previous one is
    // still encoding, several times an evening — and a warning per upload would be
    // noise an operator learns to ignore.
    onSkipped: () => logger.debug('clip drain skipped, one is already running'),
    // The use case swallows a per-clip failure by design, so reaching the catch means the
    // database is closed, locked or gone, and losing the whole server because one clip
    // could not be read would be a far worse outcome than a skipped drain.
    failedMessage: 'clip drain failed',
    describe: (report, durationMs) => {
      if (report.transcoded > 0 || report.voices > 0 || report.failed > 0 || report.rendered > 0) {
        logger.info('clip drain finished', {
          transcoded: report.transcoded,
          voices: report.voices,
          failed: report.failed,
          rendered: report.rendered,
          durationMs,
        })
      }
    },
  })

  const repeater = createRepeater({ everyMs: intervalMs, tick: () => void job.runOnce() })

  return {
    runOnce: job.runOnce,

    start: () => {
      if (repeater.active) return
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
        if (
          event.type !== 'clip.queued' &&
          event.type !== 'reel.queued' &&
          event.type !== 'voice.queued'
        ) {
          return
        }
        void job.runOnce()
      })

      repeater.start()

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
        // Each queue on its own: a fault recovering the clips must not leave the voices `running`.
        for (const recovery of [recover, recoverVoices, recoverReels]) {
          try {
            await recovery?.()
          } catch (error) {
            // Not fatal: an unrecovered job is picked up by the next boot, and refusing to
            // start the worker over it would strand every *new* clip as well.
            logger.error('clip worker could not recover interrupted jobs', {
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
        await job.runOnce()
      })()
    },

    stop: () => {
      stopping = true

      if (unsubscribe !== null) {
        unsubscribe()
        unsubscribe = null
      }
      repeater.stop()

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
      if (job.running) {
        logger.warn('shutting down during a clip transcode, it will be picked up at the next boot')
      }
    },
  }
}
