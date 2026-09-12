import type { Event } from '../../../domain/events/event'
import type { Guest } from '../../../domain/guests/guest'
import { DomainError } from '../../../domain/shared/errors'
import { Slug } from '../../../domain/shared/slug'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestRepository } from '../../ports/guestRepository'
import type { GuestTokenService } from '../../ports/guestTokenService'

/**
 * Turn a device token plus the slug in the URL into a guest of *that* event.
 *
 * A valid signature is never sufficient on its own. Four further checks stand between a
 * token and any right, and each closes a real hole:
 *
 * 1. **The token's event must match the event in the URL.** Without it, a guest at one
 *    wedding could point their own cookie at another event's endpoints. This is the
 *    cross-event attack; it has a named test here and again at rings 4 and 6.
 * 2. **The guest row must still exist.** That is what makes a signed, stateless token
 *    revocable at all.
 * 3. **The row must not be revoked**, so the host's "remove this guest" button works
 *    against a credential the server never stored.
 * 4. **The event must still accept guests**, so a closed or archived party stops
 *    granting identity rather than only stopping uploads.
 *
 * On success the guest is `touch`ed: the host's "who is here right now" count is read
 * from `lastSeenAt`, and a guest who joined an hour ago and is still uploading must not
 * be counted as gone.
 */

export interface AuthenticateGuestInput {
  /** The raw `es_guest` cookie value. Untrusted until `verify` says otherwise. */
  readonly token: string
  /** The slug from the URL — the event this request claims to be about. */
  readonly eventSlug: string
}

export interface AuthenticateGuestOutput {
  readonly guest: Guest
  /** Resolved here, so a caller never re-reads the slug and never scopes by a path. */
  readonly event: Event
}

export interface AuthenticateGuestDeps {
  readonly events: EventRepository
  readonly guests: GuestRepository
  readonly tokens: GuestTokenService
  readonly clock: Clock
}

export type AuthenticateGuest = (
  input: AuthenticateGuestInput,
) => Promise<Result<AuthenticateGuestOutput, DomainError>>

export const makeAuthenticateGuest =
  ({ events, guests, tokens, clock }: AuthenticateGuestDeps): AuthenticateGuest =>
  async (input) => {
    const now = clock.now()

    const claims = tokens.verify(input.token, now)
    if (!claims.ok) return claims

    const slug = Slug.create(input.eventSlug)
    // A slug that cannot exist is answered like a slug that does not, so a malformed
    // path is not a cheaper probe than a well-formed one.
    if (!slug.ok) return err(DomainError.notFound('event.notFound'))

    const event = await events.findBySlug(slug.value)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    // The whole reason the token carries an event id. Compared against the event
    // resolved from the URL, never against an id the client sent.
    if (claims.value.eventId !== event.id) {
      return err(DomainError.forbidden('guest.wrongEvent'))
    }

    const guest = await guests.findById(event.id, claims.value.guestId)
    // The row is gone: the guest was erased, or the event was purged and recreated. A
    // credential error rather than `guest.notFound`, because the answer the phone needs
    // is 401 — drop the cookie and scan the code again — not a 404 it cannot act on.
    if (guest === null) return err(DomainError.unauthenticated('guestToken.malformed'))
    if (guest.isRevoked()) return err(DomainError.forbidden('guest.revoked'))
    if (!event.acceptsGuests()) return err(DomainError.notFound('event.notFound'))

    const seen = guest.touch(now)
    await guests.save(seen)

    return ok({ guest: seen, event })
  }
