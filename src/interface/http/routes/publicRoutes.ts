import { Router, type Request, type RequestHandler, type Response } from 'express'
import type { Event } from '../../../domain/events/event'
import { DomainError } from '../../../domain/shared/errors'
import { asyncHandler } from '../middleware/asyncHandler'
import { GUEST_COOKIE, resolvePublicEvent } from '../middleware/authz'
import { joinLimiter } from '../middleware/rateLimit'
import { toPublicEventDto, toWallResponseDto } from '../presenters/presenters'
import { sendError, sendJson, sendResult } from '../presenters/send'
import { joinBody, wallQuery } from '../schemas/requestSchemas'
import type { JoinResponseDto } from '../presenters/dto'
import type { HttpUseCases, RouteDeps } from '../useCases'

/**
 * The two endpoints reachable with no credential at all: the front door and the
 * projector.
 *
 * Both are shaped by the same constraint. A guest arrives by pointing a phone camera at
 * a printed card, and a projector is a machine in the corner of a reception that nobody
 * is going to sign in to at 22:00 — so neither can ask for a principal. What that costs
 * is that both are enumerable, and the answer is the same in both places: **an event
 * that is not open answers exactly like an event that does not exist.** A
 * distinguishable "not started yet" would confirm that a guessed code or slug is real.
 *
 * The lifecycle rules themselves live in the domain (`acceptsGuests`, `servesWall`) and
 * are enforced by `joinEvent` and `resolvePublicEvent`; this module decides nothing
 * about them. It parses, authorizes, calls one use case, and presents.
 */

/**
 * The slice of {@link RouteDeps} the public surface needs.
 *
 * A narrow view for the same reason `HttpConfig` is one: the front door must not be able
 * to start quietly depending on moderation or on a photo repository, and naming the two
 * use cases it does call means the contract test builds exactly those two out of fakes
 * rather than a thirty-key bag of stubs that proves nothing. The container's full
 * `RouteDeps` satisfies this structurally, so `server.ts` is unchanged.
 */
export interface PublicRouteDeps extends Omit<RouteDeps, 'usecases'> {
  readonly usecases: Pick<HttpUseCases, 'joinEvent' | 'getWallPlaylist'>
}

/**
 * The guest cookie's lifetime, equal to the guest token's own 36 hours.
 *
 * Restated rather than imported: `src/interface` may not reach into an adapter, and the
 * max age belongs to `hmacGuestTokenService`. The two have to agree, and the contract
 * test pins that by verifying the issued token either side of this boundary. A cookie
 * outliving the token would leave a phone holding a credential the server rejects — an
 * upload failing at midnight with nothing on screen to explain it — and a shorter one
 * would sign a guest out while the party is still going.
 */
const GUEST_COOKIE_MAX_AGE_MS = 36 * 60 * 60 * 1000

type PublicEventHandler = (event: Event, req: Request, res: Response) => Promise<void>

/**
 * `asyncHandler` plus the one narrowing `resolvePublicEvent` leaves behind.
 *
 * The 404 is unreachable behind that middleware, which is the point: a route that ever
 * loses its authorization decision must fail closed rather than dereference an absent
 * event. A `!` here would turn that wiring bug into a `TypeError` on a projector at
 * 22:00, answered as a 500 after the fact. Exported so the guard can be exercised
 * without a route in front of it.
 */
export const withPublicEvent = (handler: PublicEventHandler): RequestHandler =>
  asyncHandler(async (req, res) => {
    const event = req.context.event
    if (event === undefined) {
      sendError(res, DomainError.notFound('event.notFound'))
      return
    }
    await handler(event, req, res)
  })

export const publicRoutes = ({ deps, usecases, presenter }: PublicRouteDeps): Router => {
  const router = Router()

  /**
   * `POST /join` — resolve a join code, identify the device, set the device cookie.
   *
   * Deliberately public: this has to work for a stranger holding nothing but a printed
   * card, so there is no principal to authorize. The rate limiter is what stands in for
   * one — this is the endpoint an attacker would enumerate, and a join is a
   * once-per-guest action, so the limit is generous for real use and hostile to a
   * script.
   *
   * The cookie already on the phone is read but never trusted: it is forwarded verbatim
   * and the use case decides whether it names a guest of *this* event, which is what
   * makes a second join from one device the same guest rather than a twin. No
   * authorization middleware stands in front, and there must not be one — a guest with
   * no cookie, an expired one, or one from another event is the ordinary case here, not
   * a 401.
   */
  router.post(
    '/join',
    joinLimiter(deps.config.rateLimits.joinPerMinute),
    asyncHandler(async (req, res) => {
      const body = joinBody.parse(req.body)
      const presented: unknown = req.cookies?.[GUEST_COOKIE]

      const result = await usecases.joinEvent({
        joinCode: body.joinCode,
        // Omitted rather than passed as `undefined`: under `exactOptionalPropertyTypes`
        // those are different types, and the use case already treats an absent name,
        // `null` and a blank string alike — anonymity is a supported choice.
        ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
        ...(typeof presented === 'string' && presented.length > 0
          ? { deviceToken: presented }
          : {}),
      })

      sendResult(res, result, (response, joined) => {
        response.cookie(GUEST_COOKIE, joined.token, {
          // A bearer credential for one event. No script needs to read it, and
          // `SameSite=Lax` still lets the guest arrive from a QR scan — the normal entry
          // path here, not the exception.
          httpOnly: true,
          sameSite: 'lax',
          secure: deps.config.secureCookie,
          path: '/',
          maxAge: GUEST_COOKIE_MAX_AGE_MS,
        })

        const dto: JoinResponseDto = {
          guestId: joined.guestId,
          displayName: joined.displayName,
          // Not the event entity: a guest learns the name and what they may do. No join
          // code echoed back, no quota, no owner, no counts.
          event: toPublicEventDto(joined.event, presenter),
        }
        sendJson(response, dto)
      })
    }),
  )

  /**
   * `GET /events/:eventSlug/wall` — what the projector shows.
   *
   * `resolvePublicEvent` in front, so a draft or archived event is a 404 before the read
   * path is reached at all. The use case answers the same way on its own; having both is
   * deliberate, because "nothing appears in front of the room without a host saying so"
   * is worth two independent gates rather than one.
   *
   * The playlist, its timings and its layout are presented exactly as the domain
   * computed them. `slideIntervalMs` and `kenBurnsDurationMs` are one value and its
   * derivation (`interval + CROSSFADE_MS`), so a route that set either of them — from a
   * query parameter, a test hook, or anything else — would make the 1.0 defect
   * representable again: a zoom out of step with the slide, snapping in front of the
   * room.
   *
   * The layout is the same shape of decision and is settled the same way. It is a
   * presentation choice belonging to one screen, so it is read from the *display* URL
   * by `web/src/features/wall/hooks/useLayoutParam.ts` and cycled by the host's `L`
   * key, alongside the timing hooks in `useTimingOverrides.ts` — all of them changing
   * one browser and never the API's answer. Nothing here parses a layout, and
   * `wallQuery` being `.strict()` means one sent anyway is a `400` rather than a
   * setting the server pretends to hold for the length of a request.
   *
   * The parse still runs with its result unused: a query string this contract does not
   * have is refused before the read path, which is what keeps a tracking parameter
   * appended to the projector's link from being quietly honoured.
   */
  router.get(
    '/events/:eventSlug/wall',
    resolvePublicEvent(deps),
    withPublicEvent(async (event, req, res) => {
      wallQuery.parse(req.query)

      const result = await usecases.getWallPlaylist({
        // The canonical `Slug` off the resolved event rather than one re-derived from the
        // URL: a handler never repeats the lookup, and never scopes a read by an id it
        // parsed out of the path itself.
        slug: event.slug,
        // Neither the layout a room sees, nor the timing, nor the size of the query a
        // passer-by can provoke is the caller's decision. `null` on each takes the
        // domain's default.
        layout: null,
        slideIntervalMs: null,
        windowSize: null,
      })

      // A live view. A cached playlist is a wall that stopped updating — and the caller
      // is a machine that runs unattended for eight hours behind whatever proxy the
      // venue has.
      res.setHeader('Cache-Control', 'no-store')

      sendResult(res, result, (response, view) => sendJson(response, toWallResponseDto(view)))
    }),
  )

  return router
}
