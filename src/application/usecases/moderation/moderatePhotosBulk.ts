import { canModerate } from '../../../domain/events/eventRole'
import {
  targetStatusFor,
  type ModerationDecision,
} from '../../../domain/moderation/moderationDecision'
import { partitionForBulk, type QueueItem } from '../../../domain/moderation/moderationQueue'
import type { Photo, PhotoActor, PhotoReview } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * One decision over a shift-clicked screenful.
 *
 * A batch must never fail as a whole. The host selects forty rows and presses reject;
 * two of them being unreachable from their current status is no reason to lose the
 * other thirty-eight, so `partitionForBulk` splits the selection and only the
 * applicable half is written. The skipped ids come back so the console can say how
 * many were left alone instead of dropping them silently.
 */

export interface ModeratePhotosBulkInput {
  readonly eventId: EventId
  readonly photoIds: readonly PhotoId[]
  readonly decision: ModerationDecision
  readonly actor: PhotoActor
}

export interface ModeratePhotosBulkDeps {
  readonly events: EventRepository
  readonly photos: PhotoRepository
  readonly memberships: MembershipRepository
  readonly bus: EventBus
  readonly clock: Clock
}

export interface BulkModerationOutcome {
  /**
   * What the decision could legally do. A photo already in the target status counts as
   * applied — re-publishing something already on the wall is exactly what the host
   * asked for — even though nothing changed and nothing is therefore announced.
   */
  readonly applied: readonly PhotoId[]
  readonly skipped: readonly PhotoId[]
}

export type ModeratePhotosBulk = (
  input: ModeratePhotosBulkInput,
) => Promise<Result<BulkModerationOutcome, DomainError>>

/**
 * The four columns the bulk rules need. Projecting here rather than passing the
 * aggregate keeps `partitionForBulk` testable with literals.
 */
const toQueueItem = (photo: Photo): QueueItem => ({
  id: photo.id,
  status: photo.status,
  createdAt: photo.createdAt,
  hasCaption: photo.caption !== null,
})

export const makeModeratePhotosBulk =
  ({ events, photos, memberships, bus, clock }: ModeratePhotosBulkDeps): ModeratePhotosBulk =>
  async ({ eventId, photoIds, decision, actor }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    if (actor.kind === 'guest') {
      return err(DomainError.forbidden('auth.forbidden', { required: 'moderator' }))
    }

    const role = await memberships.roleFor(eventId, actor.userId)
    if (role === null || !canModerate(role)) return err(DomainError.notFound('event.notFound'))

    if (!event.allowsModeration()) {
      return err(DomainError.conflict('event.notModeratable', { status: event.status }))
    }

    const found = await Promise.all(photoIds.map((photoId) => photos.findById(eventId, photoId)))
    // An id from another event misses the scoped read and is reported in neither list.
    // Calling it "skipped" would confirm to the caller that a photo they may not see
    // exists, which is the enumeration oracle the scoping exists to close.
    const items = found.flatMap((photo) => (photo === null ? [] : [toQueueItem(photo)]))

    const partition = partitionForBulk(items, decision)
    const status = targetStatusFor(decision)
    const review: PhotoReview = { kind: 'host', userId: actor.userId, at: clock.now() }

    // One statement, one transaction. 1.0 fired an update per row through `Promise.all`
    // and a failure part-way left the selection half decided.
    const changed = await photos.updateStatuses(eventId, partition.applicable, status, review)

    // Exactly what moved. A frame for a photo that was already in the target status
    // would make every projector in the room re-read its playlist for nothing.
    for (const photoId of changed) {
      bus.publish({ type: 'photo.moderated', eventId, photoId, status })
    }

    return ok({ applied: partition.applicable, skipped: partition.skipped })
  }
