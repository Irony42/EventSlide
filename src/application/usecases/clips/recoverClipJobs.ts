import { isTerminal } from '../../../domain/clips/clipJobStatus'
import type { ClipJobRepository } from '../../ports/clipJobRepository'
import type { Clock } from '../../ports/clock'
import type { Logger } from '../../ports/logger'
import type { MediaStore } from '../../ports/mediaStore'

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
  /**
   * **Because giving up on a job has to release its bytes.**
   *
   * A job this pass abandons goes to `failed`, and `holdsStagedBytes('failed')` is false
   * — so from that moment the quota stops counting up to `MAX_CLIP_BYTES` of a guest's
   * **un-stripped original**, GPS atom and all, which stays on the disk with nothing
   * left that knows how to name it. `transcodeNextClip` already deletes on a permanent
   * failure; this path had no `MediaStore` at all, and `docs/SECURITY.md` states in two
   * places that the upload is removed when the clip is given up on.
   */
  readonly media: MediaStore
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
  media,
  clock,
  logger,
}: RecoverClipJobsDeps): RecoverClipJobs => {
  return async () => {
    const recovered = await clips.recoverAbandoned(clock.now())

    // Every job this pass gave up on releases its staged source, for the same reason
    // `transcodeNextClip` does on a permanent failure: the row has stopped charging
    // those bytes to the event, so leaving them on the disk is a leak the media store's
    // own reconciliation would later report as one.
    const abandoned = recovered.filter((job) => isTerminal(job.status))
    for (const job of abandoned) {
      await media.delete(job.eventId, job.sourceHash)
    }

    const report: RecoverClipJobsReport = {
      requeued: recovered.length - abandoned.length,
      abandoned: abandoned.length,
    }

    if (recovered.length > 0) {
      // Worth a line at `info`: it is the only record that a restart interrupted work,
      // and an operator seeing it repeatedly has a clip that is killing the process.
      logger.info('recovered clip jobs left running by a previous process', {
        requeued: report.requeued,
        abandoned: report.abandoned,
      })
    }

    return report
  }
}
