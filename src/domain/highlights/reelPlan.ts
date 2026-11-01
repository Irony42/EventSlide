import { DomainError } from '../shared/errors'
import type { PhotoId } from '../shared/ids'
import { err, ok, type Result } from '../shared/result'

/** The smallest montage worth making. */
export const MIN_REEL_PHOTOS = 3

export interface ReelPolicy {
  readonly minPhotos: number
  /** `REEL_MAX_PHOTOS`: past it the montage is refused, never cut short. */
  readonly maxPhotos: number
  readonly secondsPerPhoto: number
}

export interface ReelCandidate {
  readonly id: PhotoId
  readonly createdAt: Date
}

export interface ReelPlan {
  /** The montage's order: oldest first, an id breaking a tie, so two renders agree. */
  readonly order: readonly PhotoId[]
  readonly durationMs: number
}

/**
 * The order and length of a reel made from these photographs (spec 08).
 *
 * Refuses a count outside `[minPhotos, maxPhotos]` with a code the host can act on. The server
 * never truncates in silence: a host who starred sixty-one photographs is told to remove one,
 * not shown a video that quietly lacks the last.
 */
export const planReel = (
  candidates: readonly ReelCandidate[],
  policy: ReelPolicy,
): Result<ReelPlan, DomainError> => {
  if (candidates.length < policy.minPhotos) {
    return err(
      DomainError.conflict('reel.notEnoughPhotos', {
        count: candidates.length,
        min: policy.minPhotos,
      }),
    )
  }
  if (candidates.length > policy.maxPhotos) {
    return err(
      DomainError.conflict('reel.tooManyPhotos', {
        count: candidates.length,
        max: policy.maxPhotos,
      }),
    )
  }

  const order = [...candidates]
    .sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )
    .map((candidate) => candidate.id)

  return ok({ order, durationMs: order.length * policy.secondsPerPhoto * 1000 })
}
