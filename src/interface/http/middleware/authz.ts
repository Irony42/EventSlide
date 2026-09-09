import type { RequestHandler } from 'express'
import { canModerate, canManageEvent, type EventRole } from '../../../domain/events/eventRole'
import { DomainError } from '../../../domain/shared/errors'
import { Slug } from '../../../domain/shared/slug'
import { asUserId } from '../../../domain/shared/ids'
import { sendError } from '../presenters/send'
import type { GuestPrincipal, HttpDeps, SessionPayload, UserPrincipal } from '../types'

/**
 * Authorization, resolved against **the event in the URL**.
 *
 * `requireRole('moderator')` means "a moderator of this event", never "is logged in".
 * That distinction is the whole point: 1.0 had one `isAuthenticated` check plus a
 * `partyId` column on the user row, so every authenticated user was implicitly
 * authorized for their one party, and cross-event access was prevented only by the
 * accident that the query happened to filter on the session's own `partyId`.
 *
 * A route with no explicit decision from this file is a review blocker.
 */

/** Reads the session cookie into a principal. Establishes identity, not permission. */
export const attachUser = (): RequestHandler => (req, _res, next) => {
  const session = (req.session ?? {}) as SessionPayload
  if (typeof session.userId === 'string' && typeof session.email === 'string') {
    const user: UserPrincipal = {
      kind: 'user',
      userId: asUserId(session.userId),
      email: session.email,
      mustChangePassword: session.mustChangePassword === true,
    }
    req.context.user = user
  }
  next()
}

/** Any authenticated user, for the routes that are not event-scoped (`/api/events`). */
export const requireUser: RequestHandler = (req, res, next) => {
  if (!req.context.user) {
    sendError(res, DomainError.unauthenticated('auth.required'))
    return
  }
  next()
}

/**
 * Resolves `:eventSlug` and the caller's role in it, then checks the requirement.
 *
 * Ordering matters. A caller with no session gets 401 before the event is looked up, so
 * an unauthenticated request cannot be used to discover which slugs exist. A caller
 * with a session but no membership gets **404**, not 403: a 403 would confirm the event
 * exists and turn the endpoint into an enumeration oracle for other people's events.
 */
export const requireRole =
  (required: EventRole, deps: HttpDeps): RequestHandler =>
  (req, res, next) => {
    void (async () => {
      const user = req.context.user
      if (!user) {
        sendError(res, DomainError.unauthenticated('auth.required'))
        return
      }

      const slug = Slug.create(req.params['eventSlug'])
      if (!slug.ok) {
        sendError(res, DomainError.notFound('event.notFound'))
        return
      }

      const event = await deps.events.findBySlug(slug.value)
      if (!event) {
        sendError(res, DomainError.notFound('event.notFound'))
        return
      }

      const role = await deps.memberships.roleFor(event.id, user.userId)
      if (role === null) {
        sendError(res, DomainError.notFound('event.notFound'))
        return
      }

      const permitted = required === 'owner' ? canManageEvent(role) : canModerate(role)
      if (!permitted) {
        // The caller is genuinely in scope for this event but lacks the role, so 403 is
        // honest here and reveals nothing they did not already know.
        sendError(res, DomainError.forbidden('auth.forbidden', { required }))
        return
      }

      req.context.event = event
      req.context.role = role
      next()
    })().catch(next)
  }

/**
 * Resolves the guest device token against the event in the URL.
 *
 * Three checks, and each closes a real hole:
 * 1. The token verifies — signature and age.
 * 2. **Its event matches the event in the path.** Without this, a guest at one wedding
 *    could point their own cookie at another event's upload endpoint. This is the
 *    cross-event attack, and it has named tests at rings 4 and 6.
 * 3. The guest row still exists and is not revoked, which is what makes a signed
 *    stateless token revocable at all.
 *
 * It deliberately does NOT check the event's lifecycle. Identity and permission are
 * not the same question as "may this action happen now": a guest at a closed event can
 * still view their own photos, and only the upload use case knows that it needs
 * `acceptsUploads()`. Putting the lifecycle check here would either block reads that
 * should work, or duplicate a rule the use case has to enforce anyway.
 */
export const requireGuest =
  (deps: HttpDeps): RequestHandler =>
  (req, res, next) => {
    void (async () => {
      const raw = req.cookies?.[GUEST_COOKIE]
      if (typeof raw !== 'string' || raw.length === 0) {
        sendError(res, DomainError.unauthenticated('auth.required'))
        return
      }

      const claims = deps.guestTokens.verify(raw, deps.clock.now())
      if (!claims.ok) {
        sendError(res, claims.error)
        return
      }

      const slug = Slug.create(req.params['eventSlug'])
      if (!slug.ok) {
        sendError(res, DomainError.notFound('event.notFound'))
        return
      }

      const event = await deps.events.findBySlug(slug.value)
      if (!event) {
        sendError(res, DomainError.notFound('event.notFound'))
        return
      }

      if (claims.value.eventId !== event.id) {
        sendError(res, DomainError.forbidden('guest.wrongEvent'))
        return
      }

      const guest = await deps.guests.findById(event.id, claims.value.guestId)
      if (!guest) {
        // The row is gone: the guest was erased, or the event was purged and recreated.
        sendError(res, DomainError.unauthenticated('guestToken.malformed'))
        return
      }
      if (guest.isRevoked()) {
        sendError(res, DomainError.forbidden('guest.revoked'))
        return
      }

      const principal: GuestPrincipal = { kind: 'guest', guest, eventId: event.id }
      req.context.guest = principal
      req.context.event = event
      next()
    })().catch(next)
  }

export const GUEST_COOKIE = 'es_guest'

/**
 * Resolves the event for a public route (the wall, the join lookup) without requiring
 * any principal. Still refuses an event that does not serve its wall, so the public
 * read path cannot reach a draft or archived event at all.
 */
export const resolvePublicEvent =
  (deps: HttpDeps): RequestHandler =>
  (req, res, next) => {
    void (async () => {
      const slug = Slug.create(req.params['eventSlug'])
      if (!slug.ok) {
        sendError(res, DomainError.notFound('event.notFound'))
        return
      }
      const event = await deps.events.findBySlug(slug.value)
      if (!event || !event.servesWall()) {
        sendError(res, DomainError.notFound('event.notFound'))
        return
      }
      req.context.event = event
      next()
    })().catch(next)
  }
