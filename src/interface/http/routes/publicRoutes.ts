import { Router } from 'express'
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

export const publicRoutes = ({ deps, usecases, presenter }: PublicRouteDeps): Router => {
  const router = Router()

  /**
   * `POST /join` — resolve a join code, create a guest, set the device cookie.
   *
   * Deliberately public: this has to work for a stranger holding nothing but a printed
   * card, so there is no principal to authorize. The rate limiter is what stands in for
   * one — this is the endpoint an attacker would enumerate, and a join is a
   * once-per-guest action, so the limit is generous for real use and hostile to a
   * script.
   */
  router.post(
    '/join',
    joinLimiter(deps.config.rateLimits.joinPerMinute),
    asyncHandler(async (req, res) => {
      const body = joinBody.parse(req.body)

      const result = await usecases.joinEvent({
        joinCode: body.joinCode,
        // Omitted rather than passed as `undefined`: under `exactOptionalPropertyTypes`
        // those are different types, and the use case already treats an absent name,
        // `null` and a blank string alike — anonymity is a supported choice.
        ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
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
   */
  router.get(
    '/events/:eventSlug/wall',
    resolvePublicEvent(deps),
    asyncHandler(async (req, res) => {
      const query = wallQuery.parse(req.query)

      // Resolved by the middleware, which validated the path segment and confirmed the
      // event serves its wall. Taking the canonical `Slug` off the event rather than
      // re-deriving one from the URL is the point of `RequestContext`: a handler never
      // repeats the lookup, and never scopes a read by an id it parsed out of the path
      // itself.
      const event = req.context.event
      if (event === undefined) {
        sendError(res, DomainError.notFound('event.notFound'))
        return
      }

      // The Playwright suite drives the wall with `?e2e_interval=250&e2e_transition=0`
      // so a visual test does not wait ten real seconds a slide. Honoured **only** when
      // the server was started with `E2E_HOOKS=1`, and dropped silently otherwise: the
      // config module refuses to boot production with that flag, and this is the other
      // half of that guarantee — without it anyone could dictate the projector's timing
      // from a query string.
      const hooks = deps.config.e2eHooks
      const slideIntervalMs = hooks ? (query.e2e_interval ?? null) : null
      const kenBurnsOverrideMs = hooks ? (query.e2e_transition ?? null) : null

      const result = await usecases.getWallPlaylist({
        slug: event.slug,
        layout: query.layout ?? null,
        slideIntervalMs,
        // The rotation window is the domain's own default. It is not a client setting:
        // this endpoint is public, so the size of the query it can provoke is not the
        // caller's decision.
        windowSize: null,
      })

      // A live view. A cached playlist is a wall that stopped updating — and the caller
      // is a machine that runs unattended for eight hours behind whatever proxy the
      // venue has. The header is set before the result is unwrapped so a 404 is not
      // cached either.
      res.setHeader('Cache-Control', 'no-store')

      sendResult(res, result, (response, view) => {
        const dto = toWallResponseDto(view)
        // The Ken Burns duration is derived from the interval by the domain, so there is
        // no second setting left to fall out of sync with the first. The transition hook
        // is the one exception, and it asks for a value the domain itself produces under
        // `prefers-reduced-motion`: zero, meaning no motion at all.
        sendJson(
          response,
          kenBurnsOverrideMs === null ? dto : { ...dto, kenBurnsDurationMs: kenBurnsOverrideMs },
        )
      })
    }),
  )

  return router
}
