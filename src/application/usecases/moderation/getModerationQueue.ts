import { canModerate } from '../../../domain/events/eventRole'
import {
  buildQueue,
  defaultOrderFor,
  type QueueFilter,
  type QueueItem,
  type QueueOrder,
} from '../../../domain/moderation/moderationQueue'
import type { Photo, PhotoActor } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventRepository } from '../../ports/eventRepository'
import type { PhotoQuery, PhotoRepository } from '../../ports/photoRepository'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * The moderation console's one read: the queue, plus the badge count.
 *
 * The ordering is the product rule worth protecting. A guest standing next to the
 * projector waiting for their photo must not be starved by the ten that arrived after
 * it, so the pending tab runs oldest first — and the default comes from the domain's
 * `defaultOrderFor` rather than from a query-string default, so the console, the tests
 * and any future client cannot disagree about it.
 */

export interface GetModerationQueueInput {
  readonly eventId: EventId
  readonly filter: QueueFilter
  /** `null` takes the domain's default for this tab. */
  readonly order: QueueOrder | null
  /** `null` means the whole queue. */
  readonly limit: number | null
  readonly actor: PhotoActor
}

export interface GetModerationQueueDeps {
  readonly events: EventRepository
  readonly photos: PhotoRepository
  readonly memberships: MembershipRepository
}

export interface ModerationQueueView {
  readonly items: readonly QueueItem[]
  /**
   * Photos still waiting on the host, across the whole event rather than the page in
   * hand. The domain's `pendingCount` counts the rows it is given, which would make the
   * badge shrink to the page size the moment the host applied a limit.
   */
  readonly pendingCount: number
}

export type GetModerationQueue = (
  input: GetModerationQueueInput,
) => Promise<Result<ModerationQueueView, DomainError>>

const toQueueItem = (photo: Photo): QueueItem => ({
  id: photo.id,
  status: photo.status,
  createdAt: photo.createdAt,
  hasCaption: photo.caption !== null,
})

export const makeGetModerationQueue =
  ({ events, photos, memberships }: GetModerationQueueDeps): GetModerationQueue =>
  async ({ eventId, filter, order, limit, actor }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    if (actor.kind === 'guest') {
      return err(DomainError.forbidden('auth.forbidden', { required: 'moderator' }))
    }

    const role = await memberships.roleFor(eventId, actor.userId)
    if (role === null || !canModerate(role)) return err(DomainError.notFound('event.notFound'))

    // The repository narrows by status; the domain owns the order and the page. The
    // limit is deliberately *not* pushed down: the repository returns newest first, so
    // asking it for ten rows would hand the oldest-first queue the ten newest photos —
    // precisely the starvation this ordering exists to prevent.
    const query: PhotoQuery = filter === 'all' ? {} : { statuses: [filter] }
    const page = await photos.list(eventId, query)
    const counts = await photos.countsByStatus(eventId)

    const queue = buildQueue(page.items.map(toQueueItem), {
      filter,
      order: order ?? defaultOrderFor(filter),
      limit: limit ?? undefined,
    })
    if (!queue.ok) return queue

    return ok({ items: queue.value, pendingCount: counts.pending })
  }
