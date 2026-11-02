import type { Clock } from '../../ports/clock'
import type { Logger } from '../../ports/logger'
import type { MediaStore } from '../../ports/mediaStore'
import type { ReelRepository } from '../../ports/reelRepository'

/**
 * What the worker does once at boot for the highlight reel (spec 08).
 *
 * - **A montage the dead process was rendering** goes back to the queue (the attempt it spent is
 *   counted, so a montage that kills the box does not loop for ever).
 * - **A stale montage whose file is still there** has its file deleted and its row cleared: a
 *   crash between "the row went stale" and "the file was deleted" leaves exactly that, and the
 *   file is a photograph's worth of a guest's face that the host was told is gone.
 *
 * Neither throws for a file that will not go: it is logged, and the orphan sweep is the last word.
 */

export interface RecoverReelsDeps {
  readonly reels: ReelRepository
  readonly media: MediaStore
  readonly clock: Clock
  readonly logger: Logger
}

export interface RecoverReelsReport {
  readonly requeued: number
  readonly cleaned: number
}

export type RecoverReels = () => Promise<RecoverReelsReport>

export const makeRecoverReels =
  ({ reels, media, clock, logger }: RecoverReelsDeps): RecoverReels =>
  async () => {
    const requeued = await reels.recoverAbandoned(clock.now())

    let cleaned = 0
    for (const { eventId, hash } of await reels.listStaleOutputs()) {
      try {
        await media.delete(eventId, hash)
        await reels.clearOutput(eventId, hash)
        cleaned += 1
      } catch (cause) {
        logger.warn('could not remove a stale highlight reel at boot; left for the orphan sweep', {
          eventId,
          cause: String(cause),
        })
      }
    }

    if (requeued > 0 || cleaned > 0) {
      logger.info('recovered the highlight reel queue', { requeued, cleaned })
    }
    return { requeued, cleaned }
  }
