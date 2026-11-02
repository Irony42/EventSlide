import type { EventId, PhotoId } from '../../../domain/shared/ids'
import type { Clock } from '../../ports/clock'
import type { Logger } from '../../ports/logger'
import type { MediaStore } from '../../ports/mediaStore'
import type { ReelRepository } from '../../ports/reelRepository'

/**
 * A photograph left the evening: the montage that holds it is no longer fit to show (spec 08).
 *
 * Called by every path that takes a photograph out: a deletion, a moderation that leaves
 * `published` (one photograph or a batch), a guest's erasure, the operator's takedown. **One call
 * per batch**, with all the photographs, before the caller hands control back.
 *
 * **The order is the point**, because a file and a row do not change in one transaction: the row
 * goes `stale` first (the file stops being served at that instant), then the file is deleted,
 * then the row stops naming it. A crash between the steps leaves a `stale` row naming a file,
 * which the boot sweep finishes; the serving route also re-checks every request, so a path that
 * forgot to call this is still caught. Nothing here says why: the host sees one state, so an
 * operator's takedown cannot be told from a deletion.
 *
 * It never throws. The photograph is already gone from the caller's point of view, and failing
 * the caller because a montage could not be tidied would undo a removal the host asked for.
 */

export interface InvalidateReelDeps {
  readonly reels: ReelRepository
  readonly media: MediaStore
  readonly clock: Clock
  readonly logger: Logger
}

export type InvalidateReel = (eventId: EventId, photoIds: readonly PhotoId[]) => Promise<void>

export const makeInvalidateReel =
  ({ reels, media, clock, logger }: InvalidateReelDeps): InvalidateReel =>
  async (eventId, photoIds) => {
    if (photoIds.length === 0) return
    try {
      const verdict = await reels.invalidate(eventId, photoIds, clock.now())
      if (verdict.output === null) return

      await media.delete(eventId, verdict.output)
      await reels.clearOutput(eventId, verdict.output)
    } catch (cause) {
      logger.warn('could not retire a highlight reel; the boot sweep will finish it', {
        eventId,
        cause: String(cause),
      })
    }
  }
