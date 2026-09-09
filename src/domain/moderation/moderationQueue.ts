import { canTransition, needsDecision, type PhotoStatus } from '../photos/photoStatus'
import { DomainError } from '../shared/errors'
import type { PhotoId } from '../shared/ids'
import { err, ok, type Result } from '../shared/result'
import { targetStatusFor, type ModerationDecision } from './moderationDecision'

/**
 * The moderation queue: ordering, paging, focus and batch rules as pure functions.
 *
 * Written against the smallest shape the rules need rather than against the `Photo`
 * entity. The host works through hundreds of rows on a laptop while more arrive over
 * SSE, and not one of these decisions needs a photo's hash, dimensions or author — so
 * a repository can project just these four columns out of the
 * `(event_id, status, created_at DESC)` index, the React list can hold the same shape,
 * and every rule below is testable with literals.
 */

export interface QueueItem {
  readonly id: PhotoId
  readonly status: PhotoStatus
  readonly createdAt: Date
  /**
   * The row shows a badge when the photo carries guest text, because a caption is
   * projected at the size of the room and has to be read before publishing. No rule
   * here consults it; it travels with the row so the console needs no second query.
   */
  readonly hasCaption: boolean
}

/** The console's tabs. `all` is the album view rather than a moderation view. */
export type QueueFilter = PhotoStatus | 'all'

export type QueueOrder = 'oldestFirst' | 'newestFirst'

export interface QueueRequest {
  readonly filter: QueueFilter
  readonly order: QueueOrder
  /**
   * Absent means "no page limit". Spelled `| undefined` rather than left implicit
   * because `exactOptionalPropertyTypes` would otherwise refuse the object the HTTP
   * layer builds from a query string in which the parameter was simply not sent.
   */
  readonly limit?: number | undefined
}

export interface BulkPartition {
  readonly applicable: readonly PhotoId[]
  readonly skipped: readonly PhotoId[]
}

/**
 * Oldest first while moderating: a guest waiting next to the projector for their photo
 * must not be starved by the ten that arrived after it. On every other tab the host is
 * looking at what just happened, so newest first.
 */
export const defaultOrderFor = (filter: QueueFilter): QueueOrder =>
  filter === 'pending' ? 'oldestFirst' : 'newestFirst'

export const filterQueue = (
  items: readonly QueueItem[],
  filter: QueueFilter,
): readonly QueueItem[] => {
  if (filter === 'all') return items
  return items.filter((item) => item.status === filter)
}

/**
 * Never sorts the caller's array in place: the queue arrives as React state, and
 * mutating a prop is how a list stops re-rendering while the photos keep coming.
 *
 * Ties are broken by id — ascending in both directions — instead of being left to the
 * sort's discretion, so two moderators looking at the same batch of same-second
 * arrivals see the same order and the keyboard "next" lands on the same photo on both
 * laptops. There is no equal case to model: an id is unique within an event, so the
 * same id twice would be a corrupt read rather than an ordering question.
 */
export const orderQueue = (
  items: readonly QueueItem[],
  order: QueueOrder,
): readonly QueueItem[] => {
  const direction = order === 'oldestFirst' ? 1 : -1
  return [...items].sort((left, right) => {
    const byArrival = left.createdAt.getTime() - right.createdAt.getTime()
    if (byArrival !== 0) return byArrival * direction
    return left.id < right.id ? -1 : 1
  })
}

export const buildQueue = (
  items: readonly QueueItem[],
  { filter, order, limit }: QueueRequest,
): Result<readonly QueueItem[], DomainError> => {
  // A page size of zero renders an empty console that looks like a lost queue, and a
  // fractional one silently truncates in `slice`. Both mean a caller built the query
  // wrong, so they are refused rather than interpreted.
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    return err(DomainError.invalid('moderation.limitInvalid', { limit }))
  }

  const ordered = orderQueue(filterQueue(items, filter), order)
  return ok(limit === undefined ? ordered : ordered.slice(0, limit))
}

/** What the badge shows: how many photos are still waiting on the host. */
export const pendingCount = (items: readonly QueueItem[]): number =>
  items.filter((item) => needsDecision(item.status)).length

/**
 * Where the host's focus goes after they decide, so the queue can be worked with one
 * hand on the keyboard: the next photo in the order they are actually looking at, the
 * preceding one when they just decided on the last row, and nothing when that was the
 * whole queue.
 *
 * `items` is the list as displayed, before the decision is applied. An id absent from
 * it means another moderator already dealt with that photo, or an SSE update changed
 * the list under the keystroke: focus then stays where it is rather than jumping the
 * host to an unrelated photo.
 */
export const nextAfterDecision = (
  items: readonly QueueItem[],
  decidedId: PhotoId,
  filter: QueueFilter,
  order: QueueOrder,
): PhotoId | null => {
  const ordered = orderQueue(filterQueue(items, filter), order)
  const index = ordered.findIndex((item) => item.id === decidedId)
  if (index === -1) return null

  const next = ordered[index + 1] ?? ordered[index - 1]
  if (next === undefined) return null
  return next.id
}

/**
 * Split a bulk selection into what the decision can legally do and what it cannot.
 *
 * A batch must not fail as a whole. The host shift-clicks forty rows and presses
 * reject; two of them being unreachable from their current status is no reason to
 * refuse the other thirty-eight. The skipped ids come back so the console can say how
 * many were left alone instead of losing them quietly.
 *
 * A no-op counts as applicable, matching `Photo.transitionTo`: re-publishing something
 * already on the wall is exactly what the host asked for.
 */
export const partitionForBulk = (
  items: readonly QueueItem[],
  decision: ModerationDecision,
): BulkPartition => {
  const target = targetStatusFor(decision)
  const applicable: PhotoId[] = []
  const skipped: PhotoId[] = []

  for (const item of items) {
    if (canTransition(item.status, target)) applicable.push(item.id)
    else skipped.push(item.id)
  }

  return { applicable, skipped }
}
