import { DomainError } from '../../domain/shared/errors'
import { asEventId, asGuestId } from '../../domain/shared/ids'
import { err, ok, type Result } from '../../domain/shared/result'
import type { GuestTokenClaims, GuestTokenService } from '../ports/guestTokenService'

/**
 * A `GuestTokenService` a test can both mint and read: `token|<eventId>|<guestId>|<issuedAt ms>`.
 *
 * Not the HMAC. The real service's whole job is the signature, and a faked signature asserts
 * nothing: `hmacGuestTokenService` has its own ring-3 tests, and what a use case owes is what it
 * does *after* a token verifies, which is to compare the claims with the event in the URL and with
 * the guest row. So this models exactly the three outcomes the port promises — verifies, is
 * malformed, is too old — and nothing else. It was written out in four test files, one of which
 * had no expiry, so a test of the age rule could pass against a double that never enforced it.
 */

/** The age past which the real token is refused: twelve hours, as `config` carries it. */
export const FAKE_GUEST_TOKEN_MAX_AGE_MS = 12 * 60 * 60 * 1_000

export class FakeGuestTokenService implements GuestTokenService {
  issue({ eventId, guestId, issuedAt }: GuestTokenClaims): string {
    return `token|${eventId}|${guestId}|${issuedAt.getTime()}`
  }

  verify(token: string, now: Date): Result<GuestTokenClaims, DomainError> {
    const [prefix, eventId, guestId, issuedAt] = token.split('|')
    if (prefix !== 'token' || eventId === undefined || guestId === undefined) {
      return err(DomainError.unauthenticated('guestToken.malformed'))
    }

    const issuedAtMs = Number(issuedAt)
    if (!Number.isFinite(issuedAtMs)) {
      return err(DomainError.unauthenticated('guestToken.malformed'))
    }
    if (now.getTime() - issuedAtMs > FAKE_GUEST_TOKEN_MAX_AGE_MS) {
      return err(DomainError.unauthenticated('guestToken.expired'))
    }

    return ok({
      eventId: asEventId(eventId),
      guestId: asGuestId(guestId),
      issuedAt: new Date(issuedAtMs),
    })
  }
}
