import { resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { Clock } from '../application/ports/clock'
import type { Logger } from '../application/ports/logger'
import type {
  SweepOrphanedMedia,
  SweepOrphanedMediaReport,
} from '../application/usecases/media/sweepOrphanedMedia'

/**
 * The timer for the media reconciliation sweep.
 *
 * Modelled on `retentionSweeper` line for line, and separate from it on purpose: the two
 * sweeps answer different questions, fail differently and are worth reading apart. This
 * one collects objects nothing names; that one deletes whole events a host asked to
 * expire.
 *
 * It runs on a **schedule rather than only at boot**, because an evening is longer than a
 * boot: the leaks it collects — a refused clip upload, a staging attempt that lost a race,
 * a job the box abandoned — all happen while the party is running, and waiting for the
 * next restart to reclaim them means the disk fills during the event rather than after it.
 *
 * As with the retention timer, everything that can be decided is decided in the use case:
 * this schedules, guards against overlap, and reports.
 */

export interface MediaSweeperDeps {
  /** The use case, injected as a function so a test needs no store at all. */
  readonly sweep: SweepOrphanedMedia
  readonly logger: Logger
  /** For the duration in the log line. Injected so that duration is assertable. */
  readonly clock: Clock
  readonly intervalMs: number
  /**
   * How long after `start()` the first sweep runs, and the offset the interval keeps.
   *
   * The retention purge and this sweep are on the **same interval** and were started in
   * the same tick, so they landed together — and a purge removing an event's tree with
   * `rm -r` while this walks it is a routine event reported as a failure. Offsetting them
   * costs nothing and makes the overlap the exception rather than the rule.
   */
  readonly firstDelayMs: number
}

export type MediaSweepOutcome =
  | { readonly status: 'completed'; readonly report: SweepOrphanedMediaReport }
  /** A sweep was already running. Nothing was attempted. */
  | { readonly status: 'skipped' }
  /** The sweep itself threw — the store could not be enumerated at all. */
  | { readonly status: 'failed'; readonly error: unknown }

export interface MediaSweeper {
  /** Idempotent. The first sweep happens one interval from now, never at startup. */
  start(): void
  /** Idempotent. Stops the timer; does not wait for a sweep already in flight. */
  stop(): void
  /** One sweep, now. Never rejects. */
  runOnce(): Promise<MediaSweepOutcome>
}

/**
 * How recently written an object must be for the reconciliation sweep to spare it.
 *
 * Every write path in the product is bytes first, row second, so there is always an
 * instant in which an object exists and nothing names it. Fifteen minutes is a hundred
 * times the longest of those gaps and costs only that a leak survives one more sweep,
 * which is the right direction to be wrong in: the other direction deletes a guest's
 * photograph a millisecond before the row that would have saved it.
 *
 * Exported because `scripts/purge.ts` runs the same use case from a terminal and had its
 * own copy of the number, with a comment saying it matched this one — which is a claim a
 * reader has to verify and an edit here would quietly falsify. The CLI is a different
 * trigger, never a second policy.
 *
 * **Here rather than in `container.ts`, where it used to be**, because that import made
 * the purge command load the entire server: `container.ts` imports every route, adapter
 * and use case in the product. It did not matter while `purge.ts` only ran under tsx. It
 * matters now that `tsconfig.ops.json` compiles it for the image, where the command's
 * import graph *is* what ships — and a second copy of the whole server under
 * `dist/ops/`, one `node` invocation away from being started by mistake, is not a
 * price one number should cost. This module is the one `purge.ts` already needed for
 * `isTooDangerousToSweep`, and the timer this constant configures.
 */
export const MEDIA_SWEEP_MIN_AGE_MS = 15 * 60 * 1000

/**
 * Is a recursive delete under this root a delete of somebody's whole life?
 *
 * Lives **here rather than in `container.ts`** for the reason `transcodeNextClip` states
 * about its own rules: the composition root is excluded from coverage, so a predicate
 * written there is a predicate nothing can test — and this one guards an `rm -rf`.
 *
 * `MEDIA_ROOT` is `z.string().min(1)`, so an operator can point it anywhere. The boot
 * sweep only ever targets `<root>/.uploads` and `<root>/.scratch`, so it can never eat
 * the media tree — but `MEDIA_ROOT=/` removes `/.uploads`, `MEDIA_ROOT=$HOME` removes
 * `~/.uploads`, and `/home`, `/root`, `/var`, `/mnt`, `/media`, `/srv`, `/opt`,
 * `/Users` or `C:\Users` are somebody else's `.uploads` just as surely. None of those is
 * this application's to remove.
 *
 * **When this fires, the failure mode is a deliberate leak**: the two scratch
 * directories are created but never emptied, so a `SIGKILL` mid-upload leaves up to
 * `MAX_CLIP_BYTES` on the disk until an operator removes it by hand. That is the right
 * way round. A deployment that means it gives the media root a directory of its own,
 * which is what `compose.yaml` mounts and what `.env.example` shows.
 *
 * `resolve` does not follow symlinks, so a link pointing at `$HOME` would walk straight
 * past a comparison of resolved strings — hence the caller resolves symlinks first and
 * this is asked about the real path.
 */
const SHARED_PARENTS = [
  '/home',
  '/root',
  '/var',
  '/mnt',
  '/media',
  '/srv',
  '/opt',
  // `C:\Users` needs no entry of its own: the comparison below drops the drive letter,
  // so this one covers it.
  '/Users',
]

export const isTooDangerousToSweep = (root: string): boolean => {
  const absolute = resolve(root)

  // A filesystem root: `dirname` of `/` is `/`, and of `C:\` is `C:\`.
  if (absolute === dirname(absolute)) return true
  if (absolute === resolve(homedir())) return true

  /**
   * **Not `resolve(parent)`.** On Windows `resolve('/var')` binds to the current drive,
   * so the list answered `D:\var` on a D: checkout and could never match a media root
   * on C: — the guard was decorative on the platform this was written on.
   *
   * Both sides are reduced to the *shape* rather than the volume: separators unified, a
   * leading drive letter dropped, trailing slashes trimmed, case folded. `C:\Users\x`
   * and `/Users/x` are the same kind of place and neither is ours to sweep, while a
   * media root at `D:\opt\eventslide\media` reduces to something longer than `/opt` and
   * is allowed.
   */
  const shapeOf = (path: string): string =>
    path
      .split('\\')
      .join('/')
      .replace(/^[a-zA-Z]:/, '')
      .replace(/\/+$/, '')
      .toLowerCase()

  /**
   * **The raw input as well as the resolved path**, because `resolve` is the half of
   * this that is platform-specific and the answer must not be.
   *
   * `resolve('C:\Users')` is a drive-anchored absolute path on Windows and
   * `/home/runner/work/…/C:\Users` on Linux — the same string, reduced on one platform
   * to `/users` and on the other to a working directory with a colon in it. Judging only
   * the resolved form meant this guard silently changed its mind about a Windows-shaped
   * root depending on who was asking, and the platform where it lied is the one the
   * product deploys on. The mirror holds too: `resolve('/var')` on Windows produces
   * `C:\var`, which shapes back to `/var` by luck of the current drive rather than by
   * rule.
   *
   * Reducing the input as written costs nothing — a legitimate media root is a
   * directory of its own, which shapes to neither — and makes the sentence "a shared
   * parent is refused" true on every platform instead of on the one that resolves it
   * conveniently.
   */
  const shapes = new Set([shapeOf(absolute), shapeOf(root)])
  return SHARED_PARENTS.some((parent) => shapes.has(shapeOf(parent)))
}

export const createMediaSweeper = ({
  sweep,
  logger,
  clock,
  intervalMs,
  firstDelayMs,
}: MediaSweeperDeps): MediaSweeper => {
  let timer: NodeJS.Timeout | null = null
  let firstRun: NodeJS.Timeout | null = null

  /**
   * The overlap guard, and it is not cosmetic here.
   *
   * Two sweeps over one event would both list the same orphan, both decide it is
   * unreferenced and both delete it — harmless, because `MediaStore.delete` is
   * idempotent — but they would also both walk every shard directory of every event on a
   * disk that may be serving a projector. A slow sweep is the normal case on a spinning
   * disk with four thousand photos.
   */
  let inFlight: Promise<SweepOrphanedMediaReport> | null = null

  const runOnce = async (): Promise<MediaSweepOutcome> => {
    if (inFlight !== null) {
      logger.warn('media reconciliation skipped, the previous sweep is still running')
      return { status: 'skipped' }
    }

    const startedAt = clock.now()

    try {
      // Called inside the try and assigned before the first `await`, for the two reasons
      // `retentionSweeper` documents: a synchronous throw must not escape as an unhandled
      // rejection, and the guard above must see the run.
      const run = sweep()
      inFlight = run

      const report = await run
      const durationMs = clock.now().getTime() - startedAt.getTime()

      if (report.collected > 0) {
        logger.info('media reconciliation collected orphaned objects', {
          scanned: report.scanned,
          collected: report.collected,
          bytes: report.bytes,
          durationMs,
        })
      }
      if (report.failed.length > 0) {
        // A warning rather than an error: unlike the retention sweep, nothing was
        // promised to anybody here. The bytes stay, and the next run tries again.
        logger.warn('media reconciliation could not read every event', {
          failed: report.failed.length,
          failedIds: report.failed.join(' '),
          durationMs,
        })
      }
      if (report.collected === 0 && report.failed.length === 0) {
        // Debug: a healthy installation collects nothing, and "nothing to collect" at
        // every interval is most of the log file.
        logger.debug('media reconciliation found nothing to collect', {
          scanned: report.scanned,
          durationMs,
        })
      }

      return { status: 'completed', report }
    } catch (error) {
      // The use case swallows a per-event failure by design, so reaching here means the
      // store could not be enumerated at all. Caught because an unhandled rejection from
      // a timer callback is fatal in `index.ts`, and losing the server because a
      // directory could not be listed would be far worse than one skipped sweep.
      logger.error('media reconciliation failed', {
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
      if (firstRun !== null || timer !== null) return

      // Offset, then on the interval: see `firstDelayMs`. Both handles are unref'd, so
      // neither holds the process open past `docker stop` — same reasoning as the
      // retention timer's.
      firstRun = setTimeout(() => {
        firstRun = null
        void runOnce()
        timer = setInterval(() => void runOnce(), intervalMs)
        timer.unref()
      }, firstDelayMs)
      firstRun.unref()

      logger.info('media reconciliation scheduled', { intervalMs, firstDelayMs })
    },

    stop: () => {
      if (firstRun !== null) {
        clearTimeout(firstRun)
        firstRun = null
      }
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }

      /**
       * A sweep in flight is abandoned, not awaited — and this one is safer to abandon
       * than the retention sweep is. It deletes one orphaned digest at a time and
       * decides each independently, so an interrupted run has simply collected fewer
       * objects than it would have; the rest are still orphaned, still older than the
       * minimum age, and still collected next time.
       */
      if (inFlight !== null) {
        logger.warn('shutting down during media reconciliation, the rest is left to the next run')
      }
    },
  }
}
