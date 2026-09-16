import { isTerminal } from '../../../domain/clips/clipJobStatus'
import type { ClipJobRepository } from '../../ports/clipJobRepository'
import type { Clock } from '../../ports/clock'
import type { Logger } from '../../ports/logger'

/**
 * Crash recovery for the transcode queue, run once at startup.
 *
 * A `clip_jobs` row still marked `running` when the process boots means the previous
 * process died holding it — a container restart, an `OOMKilled`, a host pulling the
 * power at the end of the night. Nothing else can be true: the queue is drained by one
 * in-process worker at concurrency 1, so there is no other claimant to wait for.
 *
 * Without this, such a job is invisible forever. It is not `queued`, so nothing claims
 * it; it is not terminal, so its staged source keeps counting against the event's quota;
 * and the guest is left watching a clip that is permanently "en cours". The guest waited
 * once already, so a recovered job goes back with **no backoff** — and a job that has
 * spent its attempts is given up on rather than handed to the next boot, because a clip
 * that takes the process down with it would otherwise cost a boot every time.
 *
 * It is a use case and not four lines in the worker for the reason the sweeps are:
 * `src/main` is excluded from coverage, and "which jobs come back and which are
 * abandoned" is a decision an operator only discovers was wrong after an album is short
 * a clip.
 */

export interface RecoverClipJobsDeps {
  readonly clips: ClipJobRepository
  readonly clock: Clock
  readonly logger: Logger
}

export interface RecoverClipJobsReport {
  /** Put back on the queue, claimable at once. */
  readonly requeued: number
  /** Given up on: they had already spent every attempt they are allowed. */
  readonly abandoned: number
}

export type RecoverClipJobs = () => Promise<RecoverClipJobsReport>

export const makeRecoverClipJobs = ({
  clips,
  clock,
  logger,
}: RecoverClipJobsDeps): RecoverClipJobs => {
  return async () => {
    const recovered = await clips.recoverAbandoned(clock.now())

    /**
     * **The staged source is deliberately left on the disk here.**
     *
     * There are two ways a clip is given up on, and they are not the same event:
     *
     * - `transcodeNextClip` gives up because **the clip's own content is at fault** — it
     *   is not a video, its header will not parse, it is longer than the cap, its frame
     *   is larger than the pixel budget. Nothing will ever come of those bytes, so it
     *   deletes them — while the job is still `running`, which is what proves no other
     *   row can be holding that digest.
     * - This pass gives up on a job that is **not in hand**: it is transitioning a row it
     *   did not claim, from `running` to `failed`, and `failed` releases the digest from
     *   the partial unique index. An unlink after that commit races the guest's own
     *   re-upload, which may already have reserved those very bytes — the same race
     *   `reapStaleReservations` refuses to take, and the reason neither of them touches
     *   the disk.
     *
     * So the bytes stay, and `sweepOrphanedMedia` collects them within an interval: it
     * asks the database rather than guessing and re-checks immediately before unlinking,
     * which is the only form of this delete that is safe. The earlier note here claimed
     * the asymmetry existed so an operator could recover the file by hand; that stopped
     * being true the moment the collector was written, and it was never the real reason.
     * The cost is honest and bounded either way: the row is terminal, so the quota has
     * stopped counting those bytes.
     */
    const abandoned = recovered.filter((job) => isTerminal(job.status))

    const report: RecoverClipJobsReport = {
      requeued: recovered.length - abandoned.length,
      abandoned: abandoned.length,
    }

    if (recovered.length > 0) {
      // Worth a line at `info`: it is the only record that a restart interrupted work,
      // and an operator seeing it repeatedly has a clip that is killing the process.
      logger.info('recovered clip jobs left behind by a previous process', {
        requeued: report.requeued,
        abandoned: report.abandoned,
      })
    }

    return report
  }
}
