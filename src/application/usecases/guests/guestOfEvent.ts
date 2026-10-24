import type { Event } from '../../../domain/events/event'
import type { Guest } from '../../../domain/guests/guest'
import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { GuestRepository } from '../../ports/guestRepository'
import type { GuestTokenClaims } from '../../ports/guestTokenService'

/**
 * Whether a **verified** token names a guest who may be at this event: the three checks that
 * stand between a valid signature and a guest, in the order they are asked.
 *
 * The one place they are written. `authenticateGuest` (every guest route, through
 * `requireGuest`) and `identifyMediaViewer` (the media route, which reads the same cookie but
 * fails open to the public instead of refusing) both call it, so a fifth check added here applies
 * to both and nobody has to remember the second.
 *
 * 1. **The token's event must be this event**, compared against the event resolved from the URL
 *    and never against an id the client sent. This is the cross-event attack.
 * 2. **The guest row must still exist**: that is what makes a signed, stateless token revocable
 *    at all. A credential error rather than `guest.notFound`, because the answer the phone needs
 *    is 401, drop the cookie and scan the code again.
 * 3. **The row must not be revoked**, so the host's "remove this guest" works against a credential
 *    the server never stored.
 *
 * What it does not ask: the event's lifecycle and its client's suspension. Those are the callers'
 * own questions, and they are asked differently (a refusal, or the public).
 */
export const guestOfEvent = async (
  guests: GuestRepository,
  claims: GuestTokenClaims,
  event: Event,
): Promise<Result<Guest, DomainError>> => {
  if (claims.eventId !== event.id) return err(DomainError.forbidden('guest.wrongEvent'))

  const guest = await guests.findById(event.id, claims.guestId)
  if (guest === null) return err(DomainError.unauthenticated('guestToken.malformed'))
  if (guest.isRevoked()) return err(DomainError.forbidden('guest.revoked'))

  return ok(guest)
}
