import { Router, type Response } from 'express'
import type { EventSummary } from '../../../application/ports/eventRepository'
import { makeListModerators } from '../../../application/usecases/events/listModerators'
import { makeRenameEvent } from '../../../application/usecases/events/renameEvent'
import { makeRevokeModerator } from '../../../application/usecases/events/revokeModerator'
import type { Event } from '../../../domain/events/event'
import type { EventRole } from '../../../domain/events/eventRole'
import type { DomainError } from '../../../domain/shared/errors'
import { asGuestId, asUserId, type EventId, type UserId } from '../../../domain/shared/ids'
import { unwrapOr, type Result } from '../../../domain/shared/result'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireRole, requireUser } from '../middleware/authz'
import {
  toEventDto,
  toEventSummaryDto,
  toGuestDto,
  toModeratorDto,
  toModeratorInviteDto,
} from '../presenters/presenters'
import type { GuestListResponseDto } from '../presenters/dto'
import { sendError, sendJson, sendResult, sendResultNoContent } from '../presenters/send'
import {
  createEventBody,
  eventSlugParams,
  eventStatusBody,
  guestListQuery,
  guestParams,
  moderatorInvitationBody,
  moderatorParams,
  renameEventBody,
  updateSettingsBody,
} from '../schemas/requestSchemas'
import type { RequestContext, UserPrincipal } from '../types'
import type { RouteDeps } from '../useCases'

/**
 * The host's surface: the dashboard, one event, its settings and lifecycle, its guests
 * and its moderators.
 *
 * Every route carries an explicit decision from `middleware/authz`. `requireUser` for
 * the two that are not event-scoped; `requireRole(…, deps)` for the rest, which means
 * "of **this** event" and never "is logged in" — 1.0 had one `isAuthenticated` check
 * and a `partyId` column, so every authenticated user was implicitly authorized for
 * their one party.
 *
 * Two consequences of docs/API.md that show up in every handler here:
 *
 * - A caller with a session but no part in the event gets **404**, not 403. A 403
 *   would confirm the event exists and turn this surface into an enumeration oracle
 *   for other people's weddings. `requireRole` makes that choice, and so does every
 *   use case below, so it holds even if one of them is ever called from elsewhere.
 * - The slug is parsed and resolved by `requireRole` before a handler runs, so
 *   handlers read the resolved `Event` off the request context instead of re-reading
 *   the raw parameter. `req.params` is parsed where something else is read out of it —
 *   a guest id, a user id — and `req.body` and `req.query` always.
 */
export const eventRoutes = ({ deps, usecases, presenter }: RouteDeps): Router => {
  const router = Router()

  /**
   * Three of these routes have no entry in `HttpUseCases` yet: renaming an event,
   * listing its memberships, and revoking one. Their rules — an archived event is
   * immutable, an event is never left without an owner — belong in the application
   * layer like every other event rule, so they live in
   * `src/application/usecases/events/` with their own unit tests and are composed here
   * from the ports `RouteDeps` already carries. When `useCases.ts` adopts them, this
   * block disappears and the handlers below do not change.
   */
  const renameEvent = makeRenameEvent({
    events: deps.events,
    memberships: deps.memberships,
    bus: deps.bus,
  })
  const listModerators = makeListModerators({ memberships: deps.memberships })
  const revokeModerator = makeRevokeModerator({ memberships: deps.memberships })

  /**
   * The counts an `EventDto` carries, read out of the caller's own dashboard listing.
   *
   * No use case answers them for a single event: they live on `EventSummary`, which is
   * a join over photos and guests that the aggregate deliberately does not know. This
   * is a presentation read — the decision was already taken by the use case above it —
   * and it is scoped to the caller, so it cannot report on an event they have no part
   * in.
   */
  const countsFor = async (userId: UserId, eventId: EventId): Promise<EventCounts> => {
    const listed = await usecases.listEventsForHost({ userId })
    // `unwrapOr` rather than a branch here: the listing cannot fail today, and a
    // branch for that would be an untestable one in a controller.
    const rows = unwrapOr<readonly EventSummary[], DomainError>(listed, [])
    return rows.find((summary) => summary.id === eventId) ?? ZERO_COUNTS
  }

  /**
   * Answers with one event. Every route that returns an `EventDto` ends here, so the
   * join code, the join URL and the counts cannot differ between them.
   */
  const sendEvent = async (
    res: Response,
    result: Result<Event, DomainError>,
    actor: { readonly userId: UserId; readonly role: EventRole },
    status = 200,
  ): Promise<void> => {
    if (!result.ok) {
      sendError(res, result.error)
      return
    }
    const counts = await countsFor(actor.userId, result.value.id)
    sendJson(res, toEventDto({ event: result.value, role: actor.role, counts }, presenter), status)
  }

  // ---------------------------------------------------------------- dashboard --

  router.get(
    '/events',
    requireUser,
    asyncHandler(async (req, res) => {
      const user = currentUser(req.context)

      const result = await usecases.listEventsForHost({ userId: user.userId })

      // An empty dashboard is a 200 with an empty list. A 404 would make "no events
      // yet" look like a broken page on a host's first login.
      return sendResult(res, result, (response, summaries) =>
        sendJson(response, { items: summaries.map((summary) => toEventSummaryDto(summary)) }),
      )
    }),
  )

  router.post(
    '/events',
    requireUser,
    asyncHandler(async (req, res) => {
      const user = currentUser(req.context)
      const body = createEventBody.parse(req.body)

      const result = await usecases.createEvent({
        ownerId: user.userId,
        name: body.name,
        // Spread conditionally rather than passed as `undefined`:
        // `exactOptionalPropertyTypes` is on, and **absent** is the value that carries
        // meaning here — it is what tells `createEvent` to derive the slug from the
        // name with the same function the create form previews with, and to apply the
        // configured default quota.
        ...(body.slug === undefined ? {} : { slug: body.slug }),
        ...(body.startsAt === undefined
          ? {}
          : { startsAt: body.startsAt === null ? null : new Date(body.startsAt) }),
        ...(body.quotaBytes === undefined || body.quotaBytes === null
          ? {}
          : { quotaBytes: body.quotaBytes }),
      })

      // The creator is the owner: `createEvent` grants that membership as part of
      // creating the event — the `owner_id` column alone would not do, since every
      // authorization decision reads `roleFor` — so there is no role to look up.
      await sendEvent(res, result, { userId: user.userId, role: 'owner' }, 201)
    }),
  )

  // ---------------------------------------------------------------- one event --

  router.get(
    '/events/:eventSlug',
    requireRole('moderator', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScope(req.context)
      const params = eventSlugParams.parse(req.params)

      const result = await usecases.getEventBySlug({ slug: params.eventSlug })

      await sendEvent(res, result, { userId: scope.user.userId, role: scope.role })
    }),
  )

  router.patch(
    '/events/:eventSlug',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScope(req.context)
      const body = renameEventBody.parse(req.body)

      const result = await renameEvent({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        name: body.name,
      })

      await sendEvent(res, result, { userId: scope.user.userId, role: scope.role })
    }),
  )

  router.patch(
    '/events/:eventSlug/settings',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScope(req.context)
      const body = updateSettingsBody.parse(req.body)

      const result = await usecases.updateEventSettings({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        // Forwarded field by field, and nothing is defaulted. An absent field means
        // "leave it alone" and `null` means "no limit" — two different intents from
        // the same form. Filling in a default here would turn "do not touch
        // retention" into "keep forever", and `retentionDays: undefined` would hand
        // the domain a value it has to guess at.
        patch: {
          ...(body.moderation === undefined ? {} : { moderation: body.moderation }),
          ...(body.allowCaptions === undefined ? {} : { allowCaptions: body.allowCaptions }),
          ...(body.allowReactions === undefined ? {} : { allowReactions: body.allowReactions }),
          ...(body.allowGuestSelfDelete === undefined
            ? {}
            : { allowGuestSelfDelete: body.allowGuestSelfDelete }),
          ...(body.guestSelfDeleteGraceSeconds === undefined
            ? {}
            : { guestSelfDeleteGraceSeconds: body.guestSelfDeleteGraceSeconds }),
          ...(body.retentionDays === undefined ? {} : { retentionDays: body.retentionDays }),
          ...(body.maxPhotosPerGuest === undefined
            ? {}
            : { maxPhotosPerGuest: body.maxPhotosPerGuest }),
        },
      })

      await sendEvent(res, result, { userId: scope.user.userId, role: scope.role })
    }),
  )

  router.post(
    '/events/:eventSlug/status',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScope(req.context)
      const body = eventStatusBody.parse(req.body)

      // Which transitions are legal is `Event.transitionTo`'s table, not a check here:
      // the console and the projector must not hold two ideas of what `archived` means.
      const result = await usecases.changeEventStatus({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        status: body.status,
      })

      await sendEvent(res, result, { userId: scope.user.userId, role: scope.role })
    }),
  )

  router.post(
    '/events/:eventSlug/join-code',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScope(req.context)

      // The emergency lever: a join link is circulating outside the venue. The old
      // code stops working immediately, and the response carries the new one so the
      // console can reprint the QR without a second request.
      const result = await usecases.rotateJoinCode({
        eventId: scope.event.id,
        actorId: scope.user.userId,
      })

      await sendEvent(res, result, { userId: scope.user.userId, role: scope.role })
    }),
  )

  router.delete(
    '/events/:eventSlug',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScope(req.context)

      // An entire album, and not undoable. Media first and rows second is the use
      // case's order, and it matters: the row is the only record that the bytes exist.
      const result = await usecases.purgeEvent({
        eventId: scope.event.id,
        actorId: scope.user.userId,
      })

      return sendResultNoContent(res, result)
    }),
  )

  // ------------------------------------------------------------------- guests --

  router.get(
    '/events/:eventSlug/guests',
    requireRole('moderator', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScope(req.context)
      // This endpoint takes no parameter, and the empty schema is parsed anyway so that
      // sending one is a 400 rather than a silent no-op. It used to accept
      // `activeWithinMinutes` and discard it — `listGuests` owns what "at the party"
      // means and always used its own window, so a host asking for two hours was
      // answered with five minutes and told nothing.
      guestListQuery.parse(req.query)

      const result = await usecases.listGuests({
        eventId: scope.event.id,
        actorId: scope.user.userId,
      })

      return sendResult(res, result, (response, { guests, activeCount }) =>
        sendJson<GuestListResponseDto>(response, {
          // Revoked guests are included: a removal the host cannot see afterwards
          // looks like a button that did nothing. The count is presence, and excludes
          // them.
          items: guests.map((guest) => toGuestDto(guest)),
          activeCount,
        }),
      )
    }),
  )

  router.post(
    '/events/:eventSlug/guests/:guestId/revoke',
    requireRole('moderator', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScope(req.context)
      const params = guestParams.parse(req.params)

      const result = await usecases.revokeGuest({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        guestId: asGuestId(params.guestId),
      })

      // Idempotent: this button is pressed on a phone in front of a projector and will
      // be double-tapped. The entity keeps the first timestamp.
      return sendResultNoContent(res, result)
    }),
  )

  // --------------------------------------------------------------- moderators --

  router.get(
    '/events/:eventSlug/moderators',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScope(req.context)

      const result = await listModerators({
        eventId: scope.event.id,
        actorId: scope.user.userId,
      })

      return sendResult(res, result, (response, memberships) =>
        sendJson(response, {
          items: memberships.map((membership) => toModeratorDto(membership)),
        }),
      )
    }),
  )

  router.post(
    '/events/:eventSlug/moderators',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScope(req.context)
      const body = moderatorInvitationBody.parse(req.body)

      const result = await usecases.registerModerator({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        email: body.email,
        // `null` is a supported choice, not a missing value: the console lists the
        // address when there is no name.
        displayName: body.displayName ?? null,
        temporaryPassword: body.temporaryPassword,
      })

      // 201: a membership now exists, and an account may have been created with it.
      // Whether it was is the response's only interesting field — `mustChangePassword`
      // is set on a created account, so the password the host typed is single-use.
      return sendResult(res, result, (response, invited) =>
        sendJson(response, toModeratorInviteDto(invited), 201),
      )
    }),
  )

  router.delete(
    '/events/:eventSlug/moderators/:userId',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScope(req.context)
      const params = moderatorParams.parse(req.params)

      // The last owner is refused by the use case, not here: an event left unowned has
      // no route back, since inviting is itself an owner's action.
      const result = await revokeModerator({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        userId: asUserId(params.userId),
      })

      return sendResultNoContent(res, result)
    }),
  )

  return router
}

interface EventCounts {
  readonly photoCount: number
  readonly pendingCount: number
  readonly guestCount: number
  readonly usedBytes: number
}

/**
 * For the one case the type demands and production does not reach: the caller's
 * listing not containing this event. `listForUser` returns every event they own or
 * moderate, and `requireRole` has already established that this is one of them.
 */
const ZERO_COUNTS: EventCounts = {
  photoCount: 0,
  pendingCount: 0,
  guestCount: 0,
  usedBytes: 0,
}

/**
 * What `requireUser` established.
 *
 * Takes the context rather than the whole request, and is exported, so the mis-wiring
 * guard below can have a named test — the same reason `streamRoutes.ts` exports
 * `openStream`. No handler here reads a principal any other way.
 */
export const currentUser = (context: RequestContext): UserPrincipal => {
  const user = context.user
  if (user === undefined) throw misWired('no principal on the request')
  return user
}

interface HostScope {
  readonly user: UserPrincipal
  /** Resolved from the slug by `requireRole`, so no handler repeats the lookup. */
  readonly event: Event
  readonly role: EventRole
}

/** What `requireRole` resolved: the caller, the event in the path, and their role in it. */
export const hostScope = (context: RequestContext): HostScope => {
  const user = currentUser(context)
  const { event, role } = context
  if (event === undefined || role === undefined) throw misWired('no resolved event on the request')
  return { user, event, role }
}

/**
 * Unreachable by construction: every route above sits behind `requireUser` or
 * `requireRole`, which answer 401 or 404 themselves and populate what these read.
 *
 * A plain `Error` rather than a `DomainError`, and deliberately not a fallback value: a
 * route mounted without its authorization middleware is a wiring bug, and it must
 * surface as one — the error handler logs it against the request id and answers an
 * opaque 500. Inventing an anonymous principal instead would turn a mis-wiring into a
 * silent authorization hole, which is the 1.0 failure mode this layer exists to
 * prevent. (`!` is unavailable here, and would hide the same thing.)
 */
const misWired = (what: string): Error =>
  new Error(`eventRoutes: ${what}; authorization middleware is mis-wired`)
