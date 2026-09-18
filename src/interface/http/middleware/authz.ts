import type { RequestHandler } from 'express'
import { canModerate, canManageEvent, type EventRole } from '../../../domain/events/eventRole'
import { canOperateSite } from '../../../domain/users/siteRole'
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
 *
 * ## Two authorities, and no ladder between them
 *
 * There is now a second question this file answers — `requireOperator`, "does this
 * account run the box" (docs/ROADMAP.md §10.1) — and the two are answered from different
 * tables and never consulted together. `requireRole` does not read a site role, by
 * construction rather than by omission: an operator who is not a member of an event is
 * refused exactly as a stranger is, and an operator who is a moderator of one is refused
 * an owner's route exactly as any moderator is. That is the whole point of the item. An
 * operator who could accidentally moderate a client's photographs would be worse than one
 * who could not help at all, so looking at a client's evening is a separate, announced,
 * time-boxed and logged capability (§10.6) that does not exist yet.
 *
 * `authz.test.ts` holds both halves, including a call-log assertion that a `requireRole`
 * request never so much as asks what the caller's site role is.
 */

/**
 * How long a host session may live from the moment it was established, however busy it
 * has been.
 *
 * Seven days, and the number is chosen so that it **can never fire during an event**.
 * The control that acts on the laptop somebody walked away from is the idle timeout —
 * 12 h, `rolling: true` — and a shorter absolute cap would buy very little against it
 * while guaranteeing that a host who signed in for Friday's setup is logged out in the
 * middle of Saturday evening. A wedding weekend is the longest thing this product is
 * used for; a week clears it and still makes "indefinitely" false.
 *
 * Because it is written into the session at login and never refreshed, it is also the
 * only backstop that does not depend on anybody remembering to check something: a
 * session nothing else refuses still ends.
 */
export const ABSOLUTE_SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Ends a session that has been alive too long, whatever it has been doing.
 *
 * This is what `docs/SECURITY.md` §2 and §6 described and the code did not have.
 * `rolling: true` plus a 12 h cookie is an *idle* timeout, and `sqliteSessionStore.touch`
 * pushes `expires_at` forward on every single request, so a session that keeps being used
 * never expired at all. The window was not twelve hours; it had no end.
 *
 * A session with **no** `issuedAt` is treated as expired rather than as fresh. Sessions
 * written before this middleware existed have none, so the first request each of them
 * makes after an upgrade ends it and the host signs in again — once. Fresh is the
 * dangerous default here and absent is exactly the case that used to be unbounded.
 *
 * Mounted ahead of `attachUser`, so by the time identity is resolved there is no session
 * left to resolve and every downstream gate answers its own ordinary refusal. It does
 * nothing at all to an anonymous request: the wall, the join page and a guest's upload
 * carry no `userId`, and ageing a session nobody signed into would only churn rows.
 */
export const enforceSessionAge =
  (deps: HttpDeps): RequestHandler =>
  (req, _res, next) => {
    const session = (req.session ?? {}) as SessionPayload
    if (typeof session.userId !== 'string') {
      next()
      return
    }

    const issuedAt = session.issuedAt
    const now = deps.clock.now().getTime()
    // A stamp in the future is expired, not fresh — the same rule the guest token takes
    // on a negative age, and for a stronger reason here: the server wrote this value, so
    // a session claiming to start later than now is a box whose clock moved (an appliance
    // with no RTC, corrected by NTP after boot), and the skew would be added to the cap.
    const withinCap =
      typeof issuedAt === 'number' &&
      Number.isFinite(issuedAt) &&
      issuedAt <= now &&
      now - issuedAt < ABSOLUTE_SESSION_LIFETIME_MS

    if (withinCap) {
      next()
      return
    }

    // The row goes, not just the principal: leaving it would let the same cookie keep
    // being touched forward by the store for as long as anything used it, which is the
    // behaviour this middleware exists to end.
    //
    // `regenerate` rather than `destroy`, and the difference is load-bearing.
    // `Session.destroy` does `delete req.session` before it calls the store, so every
    // handler downstream would meet `req.session === undefined` — which `attachUser`
    // survives and `authRoutes` does not: `regenerateSession(req.session)` on the login
    // and `destroySession(req.session)` on the logout both dereference it, so the request
    // that tripped the cap answered **500** on exactly the two routes a host reaches when
    // their session has just ended. `regenerate` destroys the same row and leaves a fresh
    // empty session in its place, so there is no hole to step in: the old row is gone,
    // `saveUninitialized: false` means the empty one is never written, and the login that
    // follows regenerates again and writes its own.
    //
    // A store that cannot delete is logged and not thrown. The session on this request is
    // empty either way, so every gate below refuses it — answering 500 instead would turn
    // a read-only disk into an outage for a refusal that has already happened, and the
    // next request tries again anyway.
    req.session.regenerate((error: unknown) => {
      if (error) {
        req.context.logger.warn('an expired session could not be discarded', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
      next()
    })
  }

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

/**
 * Any authenticated user **whose account is still switched on**, for the routes that are
 * not event-scoped (`GET`/`POST /api/events`, `POST /api/auth/password`).
 *
 * The account read is the point, and it is the same read the other two gates make: an
 * authority is resolved from storage on the request that uses it, never from what the
 * session said at login. These routes ask nothing about an event, so `roleFor` — which
 * is where a disabled account loses its authority everywhere else — is never consulted
 * on them, and without this a host disabled at 19:00 went on creating events from the
 * tab they already had open.
 *
 * The refusal is `401 auth.required`, byte for byte what a caller with no session at all
 * gets. Two reasons: there is nothing here worth distinguishing — the account may not
 * act, and why is its owner's business, not the browser's — and 401 is the answer the
 * admin console already knows how to handle, so a disabled host is returned to the login
 * form rather than left on a console where everything fails. The login then refuses
 * them with the same `auth.invalidCredentials` an unknown address gets.
 */
export const requireUser =
  (deps: HttpDeps): RequestHandler =>
  (req, res, next) => {
    void (async () => {
      const user = req.context.user
      if (!user) {
        sendError(res, DomainError.unauthenticated('auth.required'))
        return
      }

      if (!(await deps.users.isActive(user.userId))) {
        sendError(res, DomainError.unauthenticated('auth.required'))
        return
      }

      next()
    })().catch(next)
  }

/**
 * Resolves `:eventSlug` and the caller's role in it, then checks the requirement.
 *
 * Ordering matters. A caller with no session gets 401 before the event is looked up, so
 * an unauthenticated request cannot be used to discover which slugs exist. A caller
 * with a session but no membership gets **404**, not 403: a 403 would confirm the event
 * exists and turn the endpoint into an enumeration oracle for other people's events.
 *
 * `deps.memberships.roleFor` is the **only** authority consulted, and that is a rule
 * rather than an accident: an account's site role is not read here, not ranked against an
 * event role, and not used as a fallback when the membership is missing. An operator
 * asking about a client's event is a caller with no membership, and gets the 404 anybody
 * else gets.
 *
 * That one read also answers "has this account been switched off", because `roleFor`
 * itself does — the port says so, and both implementations run the contract case that
 * pins it. It is deliberately not a second check here: sixteen use cases ask the same
 * question for themselves, `registerModerator` among them, and a rule written in this
 * middleware would have been a rule those sixteen did not have.
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
 * The box, not an event: "does this account operate this instance?"
 *
 * The site-level twin of `requireRole`, and deliberately not a rung above it. It grants
 * an operator's own surface — the console, clients, invitations, ceilings, as those items
 * land — and **nothing inside anybody's event**. No handler behind this middleware may
 * read a photograph or moderate a queue; that is §10.6's job, with the time-box, the
 * announcement and the audit trail that make it acceptable.
 *
 * The role is read from storage on every request rather than carried in the session.
 * `SessionPayload` holds an identity and nothing worth stealing, and a capability copied
 * into a cookie at login is one that survives the account being switched off — which is
 * exactly the account this gate exists to be careful about.
 *
 * 403 rather than 404 on refusal, and 403 for every kind of refusal. An operator's
 * surface is not an event and reveals nothing about which events exist, so there is no
 * enumeration oracle to protect here; an account that is not an operator, one that was
 * disabled and one whose row is gone are told the same thing, which is what
 * `siteRoleFor` already collapses them into.
 */
export const requireOperator =
  (deps: HttpDeps): RequestHandler =>
  (req, res, next) => {
    void (async () => {
      const user = req.context.user
      if (!user) {
        sendError(res, DomainError.unauthenticated('auth.required'))
        return
      }

      const siteRole = await deps.users.siteRoleFor(user.userId)
      if (!canOperateSite(siteRole)) {
        sendError(res, DomainError.forbidden('auth.forbidden', { required: 'operator' }))
        return
      }

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
