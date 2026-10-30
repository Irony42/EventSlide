import type { Event } from '../../../domain/events/event'
import type { Guest } from '../../../domain/guests/guest'
import { DomainError } from '../../../domain/shared/errors'
import { Slug } from '../../../domain/shared/slug'
import { guestOfEvent } from './guestOfEvent'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestRepository } from '../../ports/guestRepository'
import type { GuestTokenService } from '../../ports/guestTokenService'
import type { Logger } from '../../ports/logger'

/**
 * Turn a device token plus the slug in the URL into a guest of *that* event.
 *
 * This is the **one** implementation: `requireGuest` (the middleware every guest route sits
 * behind) calls it and re-implements nothing, so the rules below cannot drift between a use case
 * and a handler, as they did while the middleware kept its own copy and this one was never
 * called.
 *
 * A valid signature is never sufficient on its own. Four further checks stand between a
 * token and any right, in this order, and each closes a real hole (the last three are
 * {@link guestOfEvent}, which `identifyMediaViewer` asks as well, so the two cannot drift):
 *
 * 1. **The event's client must not be suspended** (roadmap §10.7): a suspended client's
 *    guests are answered exactly as if the event were not there. It comes before the others
 *    so that a token that verifies cannot tell a suspended event from one that is absent.
 * 2. **The token's event must match the event in the URL.** Without it, a guest at one
 *    wedding could point their own cookie at another event's endpoints. This is the
 *    cross-event attack; it has a named test here and again at rings 4 and 6.
 * 3. **The guest row must still exist.** That is what makes a signed, stateless token
 *    revocable at all.
 * 4. **The row must not be revoked**, so the host's "remove this guest" button works
 *    against a credential the server never stored.
 *
 * What it deliberately does **not** check is the event's lifecycle. Identity and permission
 * are not the same question as "may this action happen now": a guest at a closed event can
 * still look at their own photographs, and a guest who uploads to one is told
 * `event.notAcceptingUploads`, which they can act on, rather than `event.notFound`, which
 * they cannot. Only the use cases that write (an upload, a rename) know they need `acceptsUploads()`, and a join code
 * is a different door (`joinEvent`, `resolveJoinCode`) that does ask `acceptsGuests()`.
 *
 * On success the guest is `touch`ed: the host's "who is here right now" count is read
 * from `lastSeenAt`, and a guest who joined an hour ago and is still uploading must not
 * be counted as gone. The write is at most one per {@link PRESENCE_WRITE_INTERVAL_MS}: this
 * runs on every guest request, the count is a five-minute window, and a row written on each
 * tap of a reaction button is cost for no reader. It is `GuestRepository.touch`, which writes
 * presence and nothing else, and it is **best effort**: the count is the only thing that reads
 * it, so a write that fails (a full disk, a locked database) is logged and the guest is let
 * through, rather than every request they make answering 500.
 */

/**
 * The finest `lastSeenAt` is kept. Far below the five-minute window the host's count is read
 * through (`PRESENCE_WINDOW_MS` in `listGuests`), so the count is off by at most this much.
 */
export const PRESENCE_WRITE_INTERVAL_MS = 30 * 1_000

export interface AuthenticateGuestInput {
  /** The raw `es_guest` cookie value. Untrusted until `verify` says otherwise. */
  readonly token: string
  /**
   * The slug from the URL — the event this request claims to be about. Whatever the router
   * handed over: `Slug.create` is what decides whether it is one.
   */
  readonly eventSlug: unknown
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
  readonly logger: Logger
}

export type AuthenticateGuest = (
  input: AuthenticateGuestInput,
) => Promise<Result<AuthenticateGuestOutput, DomainError>>

export const makeAuthenticateGuest =
  ({ events, guests, tokens, clock, logger }: AuthenticateGuestDeps): AuthenticateGuest =>
  async (input) => {
    const now = clock.now()

    const claims = tokens.verify(input.token, now)
    if (!claims.ok) return claims

    const slug = Slug.create(input.eventSlug)
    // A slug that cannot exist is answered like a slug that does not, so a malformed
    // path is not a cheaper probe than a well-formed one.
    if (!slug.ok) return err(DomainError.notFound('event.notFound'))

    const event = await events.findBySlug(slug.value)
    // A suspended client's event is **the same 404 as an unknown one** (roadmap §10.7; G2-14): a
    // token that worked yesterday tells the holder nothing today.
    if (event === null || event.isClientSuspended() || event.isTakenDown()) {
      return err(DomainError.notFound('event.notFound'))
    }

    // The token's event against the URL's, the row, the revocation: one function, shared with
    // the media route's identity.
    const found = await guestOfEvent(guests, claims.value, event, logger)
    if (!found.ok) return found
    const guest = found.value

    const seen = guest.touch(now)
    if (seen.lastSeenAt.getTime() - guest.lastSeenAt.getTime() >= PRESENCE_WRITE_INTERVAL_MS) {
      try {
        await guests.touch(event.id, guest.id, seen.lastSeenAt)
      } catch (cause) {
        logger.warn('could not record that a guest was seen; letting them through', {
          eventId: event.id,
          cause: String(cause),
        })
      }
    }

    return ok({ guest: seen, event })
  }
