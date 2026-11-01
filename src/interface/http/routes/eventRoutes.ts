import { Router, type RequestHandler, type Response } from 'express'
import multer from 'multer'
import type { Event } from '../../../domain/events/event'
import type { EventRole } from '../../../domain/events/eventRole'
import { DomainError } from '../../../domain/shared/errors'
import { asClientId, asGuestId, asUserId } from '../../../domain/shared/ids'
import type { Result } from '../../../domain/shared/result'
import { asyncHandler } from '../middleware/asyncHandler'
import { createDiskSpaceGuard } from '../middleware/diskSpaceGuard'
import { requireRole, requireUser } from '../middleware/authz'
import { hostScopeOf, userOf } from '../middleware/scope'
import {
  INVITATIONS_PER_ACCOUNT_PER_HOUR,
  VENUE_PHOTOS_PER_ACCOUNT_PER_HOUR,
  invitationIssueLimiter,
  venuePhotoLimiter,
} from '../middleware/rateLimit'
import {
  toEventDto,
  toEventSummaryDto,
  toGuestDto,
  toModeratorDto,
  toInvitationIssuedDto,
} from '../presenters/presenters'
import type { GuestListResponseDto } from '../presenters/dto'
import { sendError, sendJson, sendResult, sendResultNoContent } from '../presenters/send'
import {
  createEventBody,
  eventScheduleBody,
  eventSlugParams,
  eventStatusBody,
  guestListQuery,
  guestParams,
  moderatorInvitationBody,
  moderatorParams,
  renameEventBody,
  updateSettingsBody,
} from '../schemas/requestSchemas'
import type { RouteDeps } from '../useCases'

/**
 * `RouteDeps` plus the one piece of this surface that is not a use case: the limiter
 * guarding `POST /events`. Built once in `server.ts`, exactly as `uploadRateLimiter` is
 * — `express-rate-limit` mints a fresh `MemoryStore` per call, so constructing it here
 * instead would give every test (and, in `server.ts`, every request) its own store
 * wearing one configuration key.
 */
export interface EventRouteDeps extends RouteDeps {
  readonly creationLimiter: RequestHandler
}

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
export const eventRoutes = ({
  deps,
  usecases,
  presenter,
  creationLimiter,
}: EventRouteDeps): Router => {
  const router = Router()

  /**
   * Answers with one event. Every route that returns an `EventDto` ends here, so the
   * join code, the join URL and the counts cannot differ between them.
   *
   * What the event holds (its counts) and the limits it is under (the quota the box will
   * actually hold it to, its live window) are one use case, `getEventView`, whatever the
   * route's own use case was.
   */
  const sendEvent = async (
    res: Response,
    result: Result<Event, DomainError>,
    actor: { readonly role: EventRole },
    status = 200,
  ): Promise<void> => {
    if (!result.ok) {
      sendError(res, result.error)
      return
    }
    const { event, counts, limits } = await usecases.getEventView({ event: result.value })
    sendJson(res, toEventDto({ event, role: actor.role, counts, limits }, presenter), status)
  }

  // ---------------------------------------------------------------- dashboard --

  router.get(
    '/events',
    requireUser(deps),
    asyncHandler(async (req, res) => {
      const user = userOf(req)

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
    requireUser(deps),
    // After `requireUser`, which is what puts an account on the request for this
    // limiter to key on (P4-09 / D-14: 20 creations per account per hour, by default).
    creationLimiter,
    asyncHandler(async (req, res) => {
      const user = userOf(req)
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
        // Same conditional spread and the same reason: absent means "the product
        // defaults", which is a different thing from any template name.
        ...(body.template === undefined ? {} : { template: body.template }),
        // The creator's own language, read once in their browser and stored on the
        // event. Absent means the product default, which is a different thing from any
        // tag — and it is what an event created through the API gets.
        ...(body.wallLanguage === undefined ? {} : { wallLanguage: body.wallLanguage }),
        // Which client the event is for, when the caller says. Absent is the common case
        // and carries meaning: the use case attaches a member of one client to it, and
        // refuses a member of several who did not choose.
        ...(body.clientId === undefined ? {} : { clientId: asClientId(body.clientId) }),
      })

      // The creator is the owner: `createEvent` grants that membership as part of
      // creating the event — the `owner_id` column alone would not do, since every
      // authorization decision reads `roleFor` — so there is no role to look up.
      await sendEvent(res, result, { role: 'owner' }, 201)
    }),
  )

  // ---------------------------------------------------------------- one event --

  router.get(
    '/events/:eventSlug',
    requireRole('moderator', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      const params = eventSlugParams.parse(req.params)

      const result = await usecases.getEventBySlug({ slug: params.eventSlug })

      await sendEvent(res, result, { role: scope.role })
    }),
  )

  router.patch(
    '/events/:eventSlug',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      const body = renameEventBody.parse(req.body)

      const result = await usecases.renameEvent({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        name: body.name,
      })

      await sendEvent(res, result, { role: scope.role })
    }),
  )

  router.patch(
    '/events/:eventSlug/settings',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
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
          ...(body.allowClips === undefined ? {} : { allowClips: body.allowClips }),
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
          // The one field that is an object, and it is forwarded whole for the same
          // reason the others are forwarded singly: the three choices are one decision,
          // and `eventTheme.ts` judges them together. Nothing here decides whether the
          // palette is legible — that is the domain's answer, and this handler only
          // carries the question.
          // Rebuilt from the fields a theme is, so nothing else the body carried (the
          // photograph's URL and the retired `material`) can reach the domain or the stored JSON.
          ...(body.theme === undefined
            ? {}
            : {
                theme: {
                  accentHue: body.theme.accentHue,
                  fonts: body.theme.fonts,
                  frame: body.theme.frame,
                  ambiance: body.theme.ambiance,
                  ...(body.theme.custom === undefined
                    ? {}
                    : {
                        custom: {
                          ground: body.theme.custom.ground,
                          groundHue: body.theme.custom.groundHue,
                          faces: body.theme.custom.faces,
                        },
                      }),
                },
              }),
          ...(body.wallLanguage === undefined ? {} : { wallLanguage: body.wallLanguage }),
          // Absent leaves the message alone, `null` clears it: never defaulted here.
          ...(body.welcomeMessage === undefined ? {} : { welcomeMessage: body.welcomeMessage }),
        },
      })

      await sendEvent(res, result, { role: scope.role })
    }),
  )

  router.post(
    '/events/:eventSlug/status',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      const body = eventStatusBody.parse(req.body)

      // Which transitions are legal is `Event.transitionTo`'s table, not a check here:
      // the console and the projector must not hold two ideas of what `archived` means.
      const result = await usecases.changeEventStatus({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        status: body.status,
      })

      await sendEvent(res, result, { role: scope.role })
    }),
  )

  router.patch(
    '/events/:eventSlug/schedule',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      const body = eventScheduleBody.parse(req.body)

      // Parsed into `Date` here and nowhere else: the schema has already established
      // that each string is an ISO-8601 instant with an offset, so this cannot produce
      // an invalid date — and the aggregate refuses one anyway, because a handler is
      // not where that guarantee should live.
      const result = await usecases.scheduleEvent({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        scheduledOpenAt: body.scheduledOpenAt === null ? null : new Date(body.scheduledOpenAt),
        scheduledCloseAt: body.scheduledCloseAt === null ? null : new Date(body.scheduledCloseAt),
      })

      await sendEvent(res, result, { role: scope.role })
    }),
  )

  router.post(
    '/events/:eventSlug/join-code',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)

      // The emergency lever: a join link is circulating outside the venue. The old
      // code stops working immediately, and the response carries the new one so the
      // console can reprint the QR without a second request.
      const result = await usecases.rotateJoinCode({
        eventId: scope.event.id,
        actorId: scope.user.userId,
      })

      await sendEvent(res, result, { role: scope.role })
    }),
  )

  // ------------------------------------------------- the host's venue photograph --

  /** The multipart part's name. Anything else is `LIMIT_UNEXPECTED_FILE` from multer. */
  const VENUE_PHOTO_FIELD = 'photo'

  /**
   * Memory, for `guestRoutes`' reason: the pipeline re-encodes every byte it accepts, so a
   * temporary file would be written to be read straight back and then cleaned up on every exit.
   * One file, no text parts, and the operator's own per-file ceiling (`MAX_UPLOAD_BYTES`),
   * which is what a phone photograph of a venue is judged against anywhere else in the product.
   * Deliberately **no `fileFilter`**: it could only read the client's MIME type. The format
   * is identified from the bytes, by the pipeline.
   */
  const venuePhotoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: deps.config.uploads.maxBytes, files: 1, fields: 0 },
  })
  const venuePhotoRateLimiter = venuePhotoLimiter(VENUE_PHOTOS_PER_ACCOUNT_PER_HOUR)
  const venuePhotoDiskGuard = createDiskSpaceGuard({
    checker: deps.diskSpaceChecker,
    paths: deps.config.storage.diskSpacePaths,
    minFreeBytes: deps.config.storage.minFreeDiskBytes,
  })

  /**
   * Put up, or replace, the photograph an ambiance paints behind the evening.
   *
   * Owner only, and **authorised before a byte is buffered**: the role check, then the
   * account's budget, then the disk guard, and only then the multipart parser. Answers the
   * event, whose theme now carries the photograph's URL, so the settings form shows it with
   * no second request.
   */
  router.put(
    '/events/:eventSlug/venue-photo',
    requireRole('owner', deps),
    venuePhotoRateLimiter,
    venuePhotoDiskGuard,
    venuePhotoUpload.single(VENUE_PHOTO_FIELD),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)

      // Absent when the request was not multipart, or named another part: the same thing to
      // a host whose picker silently failed, and never a 201 for nothing.
      if (req.file === undefined) {
        sendError(res, DomainError.invalid('upload.noFiles'))
        return
      }

      const result = await usecases.setVenuePhoto({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        // The bytes and nothing else: the declared name and type are the client's words and
        // reach no layer below this one.
        bytes: req.file.buffer,
      })

      await sendEvent(res, result, { role: scope.role })
    }),
  )

  /** Take it down: the ambiance shows its bundled ground again. Owner only, and idempotent. */
  router.delete(
    '/events/:eventSlug/venue-photo',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)

      const result = await usecases.removeVenuePhoto({
        eventId: scope.event.id,
        actorId: scope.user.userId,
      })

      await sendEvent(res, result, { role: scope.role })
    }),
  )

  router.delete(
    '/events/:eventSlug',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)

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
      const scope = hostScopeOf(req)
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
      const scope = hostScopeOf(req)
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
      const scope = hostScopeOf(req)

      const result = await usecases.listModerators({
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

  // Built once for the mount, like every limiter: `express-rate-limit` gives each call its own
  // store.
  const inviteLimiter = invitationIssueLimiter(INVITATIONS_PER_ACCOUNT_PER_HOUR)

  router.post(
    '/events/:eventSlug/moderators',
    requireRole('owner', deps),
    // After the role, which is what puts an account on the request to key on, and before the
    // body is read: a refused caller costs a counter and nothing else.
    inviteLimiter,
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      const body = moderatorInvitationBody.parse(req.body)

      const result = await usecases.registerModerator({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        email: body.email,
        locale: body.locale,
      })

      // 201: an invitation now exists. **Nothing else does** — no account, no role — until
      // the person it is for accepts it, so the answer says when it ends and, if no mail went
      // out, hands the host the link to pass on. It is the same for an address that has an
      // account and one that has not. `no-store`: when there is a link, this is the only
      // time it exists outside the host's own message.
      return sendResult(res, result, (response, invited) => {
        response.setHeader('Cache-Control', 'no-store')
        sendJson(response, toInvitationIssuedDto(invited), 201)
      })
    }),
  )

  router.delete(
    '/events/:eventSlug/moderators/:userId',
    requireRole('owner', deps),
    asyncHandler(async (req, res) => {
      const scope = hostScopeOf(req)
      const params = moderatorParams.parse(req.params)

      // The last owner is refused by the use case, not here: an event left unowned has
      // no route back, since inviting is itself an owner's action.
      const result = await usecases.revokeModerator({
        eventId: scope.event.id,
        actorId: scope.user.userId,
        userId: asUserId(params.userId),
      })

      return sendResultNoContent(res, result)
    }),
  )

  return router
}
