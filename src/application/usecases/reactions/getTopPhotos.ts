import type { Photo } from '../../../domain/photos/photo'
import { isVisibleOnWall } from '../../../domain/photos/photoStatus'
import {
  topPhotos,
  totalReactions,
  type ReactionCounts,
} from '../../../domain/reactions/reactionTally'
import type { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { ReactionRepository } from '../../ports/reactionRepository'

/**
 * "Photo de la soirée": the photos the room reacted to most.
 *
 * The ranking is the domain's `topPhotos`, tie-broken by id, because this panel is
 * projected: two displays reading the same event that disagreed about the winner is the
 * same class of defect as 1.0's per-browser slideshow index.
 *
 * A photo the host has since taken off the wall is not crowned. Reactions only ever
 * land on a published photo, but a photo can be hidden or rejected afterwards and keeps
 * the rows the room left on it — putting that back on the projector as the photo of the
 * night would undo the host's decision at the loudest possible moment.
 */

export interface GetTopPhotosInput {
  readonly eventId: EventId
  readonly limit: number
}

export interface GetTopPhotosDeps {
  readonly photos: PhotoRepository
  readonly reactions: ReactionRepository
}

export interface RankedPhoto {
  readonly photo: Photo
  readonly counts: ReactionCounts
  readonly total: number
}

export type GetTopPhotos = (
  input: GetTopPhotosInput,
) => Promise<Result<readonly RankedPhoto[], DomainError>>

export const makeGetTopPhotos =
  ({ photos, reactions }: GetTopPhotosDeps): GetTopPhotos =>
  async ({ eventId, limit }) => {
    const byPhoto = await reactions.countsForEvent(eventId)
    const ranked = topPhotos(byPhoto, limit)
    if (!ranked.ok) return ranked

    const items: RankedPhoto[] = []
    for (const photoId of ranked.value) {
      // Scoped read, and it also settles the two cases the ranking cannot: a photo
      // deleted between the two reads, and one that is no longer on the wall.
      const photo = await photos.findById(eventId, photoId)
      if (photo === null || !isVisibleOnWall(photo.status)) continue

      const counts = await reactions.countsFor(eventId, photoId)
      items.push({ photo, counts, total: totalReactions(counts) })
    }

    return ok(items)
  }
