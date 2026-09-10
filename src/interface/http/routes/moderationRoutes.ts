import { Router, type Request, type Response } from 'express'
import type { PhotoActor } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import { asPhotoId, type EventId } from '../../../domain/shared/ids'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireRole } from '../middleware/authz'
import type {
  BulkModerationResponseDto,
  ModerationQueuePageDto,
  PhotoListResponseDto,
  TopPhotosResponseDto,
} from '../presenters/dto'
import {
  toModerationPhotoDto,
  toModerationQueueItemDto,
  toTopPhotoDto,
} from '../presenters/presenters'
import { sendJson, sendResult, sendResultNoContent } from '../presenters/send'
import {
  bulkModerationBody,
  moderationDecisionBody,
  moderationQueueQuery,
  photoListQuery,
  photoParams,
  topPhotosQuery,
} from '../schemas/requestSchemas'
import type { RouteDeps } from '../useCases'

/**
 * The host's console: the queue, one decision, a batch of decisions, deletion, and the
 * photo of the night.
 *
 * Every route here is `requireRole('moderator', deps)` — "a moderator **of this
 * event**", resolved against `:eventSlug`, never "is logged in". 1.0 had a single
 * shared admin password and one `isAuthenticated` check, so lending the moderation
 * screen to a friend for one wedding handed them every other event on the box.
 *
 * Nothing here decides anything. The vocabulary bridge (`publish` to `published`), the
 * legality of a transition, the queue's ordering and what a batch may skip all live in
 * the domain and the use cases; this file parses, hands the decision over, and shapes
 * the answer. That split is what let those rules acquire tests at all.
 */

interface ModeratorContext {
  readonly eventId: EventId
  /** The event's canonical slug, for building media URLs. */
  readonly slug: string
  readonly actor: PhotoActor
}

/**
 * Reads back what `requireRole` already resolved.
 *
 * The event and the principal are both populated by the middleware before any handler
 * here runs, so the guard is unreachable in production. It exists so that mounting one
 * of these routes without an authorization decision fails loudly instead of quietly
 * addressing an event of `undefined` — and so that saying that needs no `!` assertion.
 *
 * The slug comes from the resolved event rather than from the path, so the media links
 * in a response cannot differ from the ones the wall and the printed card use.
 */
const moderatorContext = (req: Request): ModeratorContext => {
  const { user, event } = req.context
  if (user === undefined || event === undefined) {
    throw DomainError.unexpected('server.unexpected')
  }
  return {
    eventId: event.id,
    slug: event.slug.value,
    actor: { kind: 'host', userId: user.userId },
  }
}

/**
 * Moderation reads are never stored.
 *
 * This is the one surface that shows photos the host has **not** approved. A shared
 * proxy or a back-forward cache holding that page would show a decided photo as still
 * pending — inviting a second decision on it — and would put a rejected photo back in
 * front of whoever borrows the laptop next.
 */
const noStore = (res: Response): void => {
  res.setHeader('Cache-Control', 'no-store')
}

export const moderationRoutes = ({ deps, usecases }: RouteDeps): Router => {
  const router = Router()

  /**
   * The queue, plus the badge count.
   *
   * `order: null` takes the domain's `defaultOrderFor`, which is oldest-first on the
   * pending tab: a guest standing next to the projector waiting for their photo must
   * not be starved by the ten that arrived after it. Reading an order off the query
   * string instead would let the console, the tests and a future client disagree about
   * the one rule this screen exists to keep.
   */
  router.get(
    '/events/:eventSlug/moderation',
    requireRole('moderator', deps),
    asyncHandler(async (req, res) => {
      const query = moderationQueueQuery.parse(req.query)
      const { eventId, slug, actor } = moderatorContext(req)

      const result = await usecases.getModerationQueue({
        eventId,
        filter: query.status,
        order: null,
        limit: query.limit,
        actor,
      })

      noStore(res)
      return sendResult(res, result, (response, view) =>
        sendJson<ModerationQueuePageDto>(response, {
          items: view.items.map((item) => toModerationQueueItemDto({ item, slug })),
          pendingCount: view.pendingCount,
          // The queue is not cursor-paged, and cannot be: the domain orders the whole
          // filtered set *before* applying the limit, precisely so the oldest pending
          // photo cannot be pushed off the page by newer arrivals. Reported as `null`
          // rather than omitted, so the client reads one shape either way.
          nextCursor: null,
        }),
      )
    }),
  )

  /**
   * The admin gallery: the same photos, newest first and cursor-paged, without the
   * queue's ordering. By cursor rather than by offset because guests keep uploading
   * while a host scrolls, and an offset silently skips or repeats a photo as rows
   * shift under the page.
   */
  router.get(
    '/events/:eventSlug/photos',
    requireRole('moderator', deps),
    asyncHandler(async (req, res) => {
      const query = photoListQuery.parse(req.query)
      const { eventId, slug } = moderatorContext(req)

      const result = await usecases.listEventPhotos({
        eventId,
        // The wire carries one status; the port takes a list. `null` is "no filter",
        // which is the host's full album view.
        statuses: query.status === 'all' ? null : [query.status],
        limit: query.limit,
        // `exactOptionalPropertyTypes`: an absent cursor is `null`, never a present
        // key holding `undefined`.
        cursor: query.cursor ?? null,
      })

      noStore(res)
      return sendResult(res, result, (response, page) =>
        sendJson<PhotoListResponseDto>(response, {
          // `authorName` is null because this read resolves no guest. Looking one up
          // here would mean a controller reading a repository, and inventing a
          // fallback here would put French copy in the server — the client owns the
          // wording for an unattributed photo.
          items: page.items.map((photo) => toModerationPhotoDto({ photo, slug, authorName: null })),
          nextCursor: page.nextCursor,
        }),
      )
    }),
  )

  /**
   * One decision on one photo.
   *
   * The body carries the host's verb (`publish`), never the resulting state
   * (`published`), and the schema enforces it. The two vocabularies are kept apart so
   * that a client can never post a status it invented, and so that the status machine
   * stays free to grow a state no keystroke maps to.
   */
  router.patch(
    '/events/:eventSlug/photos/:photoId/status',
    requireRole('moderator', deps),
    asyncHandler(async (req, res) => {
      const params = photoParams.parse(req.params)
      const body = moderationDecisionBody.parse(req.body)
      const { eventId, actor } = moderatorContext(req)

      const result = await usecases.moderatePhoto({
        eventId,
        photoId: asPhotoId(params.photoId),
        decision: body.decision,
        actor,
      })

      return sendResultNoContent(res, result)
    }),
  )

  /**
   * One decision over a shift-clicked screenful.
   *
   * A batch **skips** what the decision cannot legally do rather than failing
   * wholesale: the host selects forty rows and presses reject, and two of them being
   * unreachable from their current status is no reason to lose the other thirty-eight.
   * The skipped ids come back so the console can say how many were left alone instead
   * of dropping them silently. Ids from another event miss the event-scoped read and
   * appear in neither list — reporting them as skipped would confirm that a photo the
   * caller may not see exists.
   */
  router.post(
    '/events/:eventSlug/moderation/bulk',
    requireRole('moderator', deps),
    asyncHandler(async (req, res) => {
      const body = bulkModerationBody.parse(req.body)
      const { eventId, actor } = moderatorContext(req)

      const result = await usecases.moderatePhotosBulk({
        eventId,
        photoIds: body.photoIds.map(asPhotoId),
        decision: body.decision,
        actor,
      })

      return sendResult(res, result, (response, outcome) =>
        sendJson<BulkModerationResponseDto>(response, {
          applied: outcome.applied,
          skipped: outcome.skipped,
        }),
      )
    }),
  )

  /**
   * A moderator removing any photo in their event.
   *
   * `guestRoutes` defines a `DELETE` on this same path for a guest taking back a photo
   * they regret, and `server.ts` mounts it first, so which handler answers is decided
   * by mount order rather than here. The actor is always a host: the request reached a
   * moderator's session, and `Photo.canBeDeletedBy` grants a host the deletion
   * unconditionally — pulling a photo off the wall mid-slideshow is the host's call.
   */
  router.delete(
    '/events/:eventSlug/photos/:photoId',
    requireRole('moderator', deps),
    asyncHandler(async (req, res) => {
      const params = photoParams.parse(req.params)
      const { eventId, actor } = moderatorContext(req)

      const result = await usecases.deletePhoto({
        eventId,
        photoId: asPhotoId(params.photoId),
        actor,
      })

      return sendResultNoContent(res, result)
    }),
  )

  /**
   * "Photo de la soirée": what the room reacted to most.
   *
   * The ranking, its tie-break and the rule that a photo the host has since taken off
   * the wall is not crowned all belong to the use case. Authorization is this route's
   * alone: `getTopPhotos` takes no actor, so `requireRole` is the only thing standing
   * between another host's event and this panel.
   */
  router.get(
    '/events/:eventSlug/top-photos',
    requireRole('moderator', deps),
    asyncHandler(async (req, res) => {
      const query = topPhotosQuery.parse(req.query)
      const { eventId, slug } = moderatorContext(req)

      const result = await usecases.getTopPhotos({ eventId, limit: query.limit })

      noStore(res)
      return sendResult(res, result, (response, ranked) =>
        sendJson<TopPhotosResponseDto>(response, {
          items: ranked.map(({ photo, counts, total }) =>
            toTopPhotoDto({ photo, slug, counts, total }),
          ),
        }),
      )
    }),
  )

  return router
}
