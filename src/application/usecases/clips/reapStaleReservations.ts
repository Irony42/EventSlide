import type { ClipJobRepository } from '../../ports/clipJobRepository'
import type { Clock } from '../../ports/clock'
import type { Logger } from '../../ports/logger'

/**
 * Delete the reservations of requests that died before their bytes arrived.
 *
 * A `reserved` row is the moment between "this upload is admitted" and "its source is on
 * the disk" — normally a local `writeFile`, because multer has already streamed the
 * upload to a temporary file before the use case is reached. One that outlives that
 * window belonged to a process that is gone, and it is holding three things it should
 * not:
 *
 * - **a charge against the event's quota**, for bytes that do not exist. `holdsStagedBytes`
 *   counts a reservation deliberately, and the quota spans `photos` as well — so the
 *   album's own room shrinks by up to `MAX_CLIP_BYTES` per stranded row;
 * - **one of `MAX_QUEUED_CLIPS` global slots**, so twenty of them answer every clip upload
 *   on the box with a `429` that never clears;
 * - **that digest**, through the partial unique index, so the guest's own retry is deduped
 *   onto a job that will never move and they are told `202` about it all evening.
 *
 * **This is why it is a separate use case from `recoverClipJobs`.** That one may run only
 * at boot: `recoverAbandoned` treats every `running` row as the wreckage of a dead
 * process, which is true at startup and false at any other moment — running it on a timer
 * would yank a clip out from under the encoder that is working on it. Reaping a
 * reservation has no such constraint, so it runs on a short interval and a crash at 19:00
 * costs a guest five minutes rather than the rest of the evening.
 *
 * It deletes **rows only**. See `sweepOrphanedMedia` for why the bytes are its business:
 * the row goes inside a transaction and any unlink would necessarily follow the commit,
 * so a re-upload that wins the digest in that gap would lose its own source. The
 * collector asks the database instead, refuses any digest a live row names, and will not
 * touch anything written recently — which is the race-free answer to the same question.
 */

export interface ReapStaleReservationsPolicy {
  /**
   * How long a reservation may sit before it is treated as wreckage.
   *
   * Generous against the single `writeFile` it protects. It is not zero because a
   * `docker compose up --force-recreate` can overlap containers, and deleting a
   * reservation the *old* container is still filling would cost that guest their upload
   * for nothing.
   */
  readonly reservationTimeoutMs: number
}

export interface ReapStaleReservationsDeps {
  readonly clips: ClipJobRepository
  readonly clock: Clock
  readonly logger: Logger
  readonly policy: ReapStaleReservationsPolicy
}

export interface ReapStaleReservationsReport {
  /** Rows deleted. Zero on a healthy box, every time, for ever. */
  readonly reaped: number
}

export type ReapStaleReservations = () => Promise<ReapStaleReservationsReport>

export const makeReapStaleReservations = ({
  clips,
  clock,
  logger,
  policy,
}: ReapStaleReservationsDeps): ReapStaleReservations => {
  return async () => {
    const olderThan = new Date(clock.now().getTime() - policy.reservationTimeoutMs)
    const reaped = await clips.deleteStaleReservations(olderThan)

    if (reaped.length > 0) {
      // Worth a line at `info`: each one is a request that died holding an upload, and a
      // figure that keeps climbing is a box being killed mid-write.
      logger.info('reaped clip reservations whose bytes never arrived', {
        reaped: reaped.length,
        clipJobIds: reaped.map((job) => job.id).join(' '),
      })
    }

    return { reaped: reaped.length }
  }
}
