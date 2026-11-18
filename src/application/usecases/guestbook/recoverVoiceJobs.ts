import type { Clock } from '../../ports/clock'
import type { GuestbookVoiceRepository } from '../../ports/guestbookVoiceRepository'
import type { Logger } from '../../ports/logger'

/**
 * Crash recovery for the voice queue, run once at startup (spec 25, section 5). The twin of
 * `recoverClipJobs`, for the same reason and with the same two rules.
 *
 * A voice still `running` when the process boots means the previous one died holding it: a
 * container restart, an `OOMKilled`, the power going at the end of the night. The queue is drained
 * by one in-process worker at concurrency 1, so there is no other claimant to wait for. Without
 * this the voice is invisible for ever: not `queued`, so nothing claims it; not terminal, so its
 * source keeps counting against the event's quota; and the guest watches "En traitement" for the
 * rest of the evening. The guest waited once already, so a recovered voice goes back **at once**,
 * with no backoff, and one that has spent its attempts is given up on rather than handed to the
 * next boot: a recording that takes the process down with it would otherwise cost a boot each time.
 *
 * **The source of an abandoned voice stays on the disk**, as a clip's does: `failed` releases the
 * digest from the unique index, so an unlink after that commit would race the guest's own resend
 * for bytes a new reservation now owns. `sweepOrphanedMedia` asks the database and collects it.
 *
 * It is a use case and not four lines in the worker because `src/main` is excluded from coverage,
 * and "which voices come back and which are abandoned" is a decision an operator only discovers
 * was wrong after a message is missing from the book.
 */

export interface RecoverVoiceJobsDeps {
  readonly voices: GuestbookVoiceRepository
  readonly clock: Clock
  readonly logger: Logger
}

export interface RecoverVoiceJobsReport {
  /** Put back on the queue, claimable at once. */
  readonly requeued: number
  /** Given up on: they had already spent every attempt they are allowed. */
  readonly abandoned: number
}

export type RecoverVoiceJobs = () => Promise<RecoverVoiceJobsReport>

export const makeRecoverVoiceJobs = ({
  voices,
  clock,
  logger,
}: RecoverVoiceJobsDeps): RecoverVoiceJobs => {
  return async () => {
    const recovered = await voices.requeueRunning(clock.now())

    const abandoned = recovered.filter((entry) => entry.voice?.state === 'failed')
    const report: RecoverVoiceJobsReport = {
      requeued: recovered.length - abandoned.length,
      abandoned: abandoned.length,
    }

    if (recovered.length > 0) {
      // The only record that a restart interrupted work: an operator seeing it repeatedly has a
      // recording that is killing the process.
      logger.info('recovered voice messages left behind by a previous process', {
        requeued: report.requeued,
        abandoned: report.abandoned,
      })
    }

    return report
  }
}
