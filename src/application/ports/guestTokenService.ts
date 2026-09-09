import type { DomainError } from '../../domain/shared/errors'
import type { EventId, GuestId } from '../../domain/shared/ids'
import type { Result } from '../../domain/shared/result'

/**
 * The guest's credential.
 *
 * A guest never creates an account. They open `/join/:code`, optionally give a first
 * name, and receive this token in an `HttpOnly`, `SameSite=Lax` cookie. It is an
 * HMAC-signed statement of two facts: which event, and which guest row.
 *
 * What it grants — and nothing more:
 * - upload to **that one event**, while the event is `live`;
 * - deletion of **their own** photo, inside the grace window;
 * - a reaction, subject to the budget.
 *
 * That scoping is the fix for 1.0, where `/api/upload` was fully public and took the
 * event name from a query parameter, so anyone who found the URL could write to any
 * event name they liked — including one that did not exist yet.
 *
 * Why HMAC rather than a session row: the projector and a few hundred phones would
 * otherwise each hold a server-side session for a single upload. A signed token needs
 * no storage, and revocation is still possible because the `guests` row it names can
 * be marked revoked — which is checked on every use.
 */

export interface GuestTokenClaims {
  readonly eventId: EventId
  readonly guestId: GuestId
  readonly issuedAt: Date
}

export interface GuestTokenService {
  issue(claims: GuestTokenClaims): string

  /**
   * Verify signature, structure and age. Constant-time comparison of the MAC, and
   * `now` is passed in so expiry is testable.
   *
   * Fails with `guestToken.malformed`, `guestToken.badSignature` or
   * `guestToken.expired` — all of which the HTTP layer answers identically, so a
   * client learns nothing about which check failed.
   *
   * A valid token is not sufficient authorization on its own: the caller must still
   * load the guest row and confirm it is not revoked, and confirm the event in the URL
   * matches the event in the claims.
   */
  verify(token: string, now: Date): Result<GuestTokenClaims, DomainError>
}
