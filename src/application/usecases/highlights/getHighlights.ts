import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventRepository } from '../../ports/eventRepository'
import type { MediaStore } from '../../ports/mediaStore'
import { REEL_VARIANT } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { ReelRepository } from '../../ports/reelRepository'
import { toReelView, type ReelView } from './reelView'
import { requireReadable } from '../shared/eventRole'

/**
 * What the host's best-of panel shows: how many favourites there are.
 *
 * The count is the repository's `countHighlighted`, the same predicate the ZIP lists with,
 * so "12 favourites" never becomes an empty archive. It also carries the montage's state, which the
 * panel polls while one is made.
 */

export interface GetHighlightsDeps {
  readonly events: Pick<EventRepository, 'findById'>
  readonly photos: Pick<PhotoRepository, 'countHighlighted'>
  readonly reels: Pick<ReelRepository, 'findByEvent'>
  readonly media: Pick<MediaStore, 'exists'>
  /** `REEL_SECONDS_PER_PHOTO`: how a finished montage's length says how many photographs it holds. */
  readonly secondsPerPhoto: number
}

export type GetHighlights = (input: {
  readonly eventId: EventId
}) => Promise<Result<{ readonly count: number; readonly reel: ReelView | null }, DomainError>>

export const makeGetHighlights =
  ({ events, photos, reels, media, secondsPerPhoto }: GetHighlightsDeps): GetHighlights =>
  async ({ eventId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))
    const readable = requireReadable(event)
    if (!readable.ok) return readable

    const count = await photos.countHighlighted(eventId)
    const job = await reels.findByEvent(eventId)
    if (job === null) return ok({ count, reel: null })

    // A finished montage whose file is gone is read as stale, never as ready.
    const fileIsThere =
      job.output !== null && (await media.exists(eventId, job.output.hash, REEL_VARIANT))
    return ok({ count, reel: toReelView(job, fileIsThere, secondsPerPhoto) })
  }
