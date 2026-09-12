import { canModerate } from '../../../domain/events/eventRole'
import {
  buildQueue,
  defaultOrderFor,
  type QueueFilter,
  type QueueItem,
  type QueueOrder,
} from '../../../domain/moderation/moderationQueue'
import type { MediaKind } from '../../../domain/photos/mediaKind'
import type { Photo, PhotoActor } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestRepository } from '../../ports/guestRepository'
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
 *
 * It is **one** read model, and it is this use case's job to return all of it. A
 * controller may not enrich a response with a second repository call, so a row that the
 * console renders but this read does not carry is a field the client invents — which is
 * exactly how the card shipped reading "par undefined" to a host mid-event.
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
  readonly guests: GuestRepository
  readonly memberships: MembershipRepository
}

/**
 * One row of the console, as the host reads it.
 *
 * The domain's {@link QueueItem} is the projection every queue *rule* needs; this is
 * what the screen needs on top of it. A moderator decides what will be projected three
 * metres wide in front of a room, so the row carries the caption text rather than a
 * badge saying one exists — "has to be read before publishing" and "shows a boolean"
 * cannot both be true — and the sender's name, which is half of what the host is
 * judging: the same photo reads differently from a bridesmaid and from a stranger.
 *
 * Note what is still absent. A moderation row may carry more than a wall item, because
 * a moderator is not the room, but no content hash, storage key or absolute path
 * appears here: nothing on this row describes where a file lives.
 */
export interface ModerationQueueRow extends QueueItem {
  readonly width: number
  readonly height: number
  /** The text itself. `hasCaption` above stays what the domain's rules read. */
  readonly caption: string | null
  /**
   * `null` whenever there is nobody to name — an anonymous guest, a host's own upload,
   * or a guest row that has since gone. The French for an unattributed photo is the
   * client's to choose (`fr.moderation.byAnonymous`); inventing "Invité" here would put
   * UI copy in a use case and make two clients disagree about it.
   */
  readonly authorName: string | null
  /**
   * Whether this row is a photograph or a clip, and how long the clip runs.
   *
   * The console needs both to decide what control to render, and a moderator deciding
   * about a clip has to be able to watch it — a poster frame is not a decision about
   * fifteen seconds of video. Carried on the row rather than looked up again by the
   * presenter, for the same reason `authorName` is: a presenter that reached for a
   * repository would be a controller doing a second read.
   */
  readonly kind: MediaKind
  /** `null` for a photograph. Milliseconds, measured on the stored file. */
  readonly durationMs: number | null
}

export interface ModerationQueueView {
  readonly items: readonly ModerationQueueRow[]
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

const toRow = (photo: Photo, names: ReadonlyMap<GuestId, string>): ModerationQueueRow => ({
  id: photo.id,
  status: photo.status,
  createdAt: photo.createdAt,
  hasCaption: photo.caption !== null,
  width: photo.dimensions.width,
  height: photo.dimensions.height,
  caption: photo.caption?.value ?? null,
  // A host upload has no guest behind it, and a name the batch did not return is a
  // guest who stayed anonymous or whose row is gone. Both are "no name", never a
  // fabricated one.
  authorName: photo.author.kind === 'guest' ? (names.get(photo.author.guestId) ?? null) : null,
  kind: photo.kind,
  durationMs: photo.facet.kind === 'clip' ? photo.facet.duration.ms : null,
})

/**
 * Every sender's name, in **one** repository read.
 *
 * A queue is many photos by few guests, so the shape is batch-then-join: collect the
 * distinct senders, ask once, map the answer back onto the rows. A `findById` inside the
 * loop would be an N+1 on the screen that refetches on every arriving photo — the
 * console is a laptop at a party, and the queue reloads over SSE all evening.
 *
 * Deduplicated by guest, so the request grows with the guests in the room rather than
 * with the photos on the screen. Scoped by `eventId` before anything else: a name read
 * that could reach another event's guest list would be a leak, not a missing feature.
 */
const resolveAuthorNames = async (
  guests: GuestRepository,
  eventId: EventId,
  photos: readonly Photo[],
): Promise<ReadonlyMap<GuestId, string>> => {
  const senders = new Set<GuestId>()
  for (const photo of photos) {
    if (photo.author.kind === 'guest') senders.add(photo.author.guestId)
  }

  return guests.findNamesByIds(eventId, [...senders])
}

export const makeGetModerationQueue =
  ({ events, photos, guests, memberships }: GetModerationQueueDeps): GetModerationQueue =>
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
    const names = await resolveAuthorNames(guests, eventId, page.items)

    // The rows are assembled before the domain orders them, and `buildQueue` hands back
    // the very rows it was given — so the caption and the sender travel with the row
    // through the sort. Ordering first and looking each photo up again afterwards would
    // reintroduce a join the query already did, with a miss case that cannot happen.
    const queue = buildQueue(
      page.items.map((photo) => toRow(photo, names)),
      {
        filter,
        order: order ?? defaultOrderFor(filter),
        limit: limit ?? undefined,
      },
    )
    if (!queue.ok) return queue

    return ok({ items: queue.value, pendingCount: counts.pending })
  }
