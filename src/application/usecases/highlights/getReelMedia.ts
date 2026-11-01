import { isReelEligible } from '../../../domain/highlights/highlightEligibility'
import type { ContentHash } from '../../../domain/photos/contentHash'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventRepository } from '../../ports/eventRepository'
import { REEL_VARIANT, type ByteRange, type MediaStore } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { ReelRepository } from '../../ports/reelRepository'
import { requireReadable } from '../shared/eventRole'
import type { InvalidateReel } from './invalidateReel'

/**
 * The finished montage's bytes, for the host who downloads or plays it (spec 08).
 *
 * **Every request re-checks that every photograph of the montage is still eligible**, before a
 * byte is opened. This is the net under the five removal hooks: a path that forgot to retire the
 * montage, or a crash between "the photograph went" and "the montage was marked", is caught here,
 * the first time anybody asks, by retiring the montage then and answering as if there were none.
 * A player's successive `Range` requests are each judged, so a montage cannot be half-served after
 * a photograph leaves.
 *
 * One answer for every way there is nothing to serve: `404 reel.notReady`, whether the montage is
 * queued, failed, stale, or its file is gone (a restored backup), and with no reason.
 */

export interface ReelMedia {
  readonly contentHash: ContentHash
  readonly byteSize: number
  readonly contentType: string
  readonly open: (range?: ByteRange) => Promise<AsyncIterable<Uint8Array> | null>
}

export interface GetReelMediaDeps {
  readonly events: Pick<EventRepository, 'findById'>
  readonly photos: Pick<PhotoRepository, 'findById'>
  readonly reels: Pick<ReelRepository, 'findByEvent'>
  readonly media: Pick<MediaStore, 'stat' | 'openRead'>
  readonly invalidateReel: InvalidateReel
}

export type GetReelMedia = (input: {
  readonly eventId: EventId
}) => Promise<Result<ReelMedia, DomainError>>

const notReady = (): DomainError => DomainError.notFound('reel.notReady')

export const makeGetReelMedia =
  ({ events, photos, reels, media, invalidateReel }: GetReelMediaDeps): GetReelMedia =>
  async ({ eventId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))
    const readable = requireReadable(event)
    if (!readable.ok) return readable

    const job = await reels.findByEvent(eventId)
    if (job === null || job.status !== 'done' || job.output === null) return err(notReady())

    for (const photoId of job.photoIds) {
      const photo = await photos.findById(eventId, photoId)
      if (photo === null || !isReelEligible(photo.status, photo.kind)) {
        // The net: retire it now, whoever forgot to.
        await invalidateReel(eventId, [photoId])
        return err(notReady())
      }
    }

    const { hash } = job.output
    const metadata = await media.stat(eventId, hash, REEL_VARIANT)
    if (metadata === null) return err(notReady())

    return ok({
      contentHash: hash,
      byteSize: metadata.byteSize,
      contentType: metadata.contentType,
      open: (range) => media.openRead(eventId, hash, REEL_VARIANT, range),
    })
  }
