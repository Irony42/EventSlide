import { describe, expect, it } from 'vitest'
import { asEventId, asGuestId } from '../../../domain/shared/ids'
import type { GuestTokenService } from '../../ports/guestTokenService'

/**
 * What a use case leans on in `GuestTokenService`, held against the fake and the HMAC service:
 * a token it issued verifies to the same claims (to the millisecond), anything else is refused
 * with the code the wire carries, and the age window is 36 hours, inclusive, with a token dated
 * in the future refused as expired.
 *
 * Not here: `guestToken.badSignature`, which a double that does not sign cannot say.
 */
const MAX_AGE_MS = 36 * 60 * 60 * 1000
const CLAIMS = {
  eventId: asEventId('evt-wedding'),
  guestId: asGuestId('guest-lea'),
  issuedAt: new Date('2026-11-01T18:00:00.123Z'),
}
const at = (ms: number): Date => new Date(CLAIMS.issuedAt.getTime() + ms)

export const guestTokenServiceContract = (
  name: string,
  makeService: () => GuestTokenService,
): void => {
  describe(`GuestTokenService contract: ${name}`, () => {
    it('verifies a token it issued to the claims it was given', () => {
      const service = makeService()

      const verified = service.verify(service.issue(CLAIMS), at(1_000))

      expect(verified.ok && verified.value).toEqual(CLAIMS)
    })

    it('still accepts a token on the last millisecond of its window', () => {
      const service = makeService()

      expect(service.verify(service.issue(CLAIMS), at(MAX_AGE_MS)).ok).toBe(true)
    })

    it('refuses a token one millisecond past its window, as expired', () => {
      const service = makeService()

      const verified = service.verify(service.issue(CLAIMS), at(MAX_AGE_MS + 1))

      expect(!verified.ok && verified.error.code).toBe('guestToken.expired')
    })

    it('refuses a token dated in the future, as expired', () => {
      const service = makeService()

      const verified = service.verify(service.issue(CLAIMS), at(-1))

      expect(!verified.ok && verified.error.code).toBe('guestToken.expired')
    })

    it.each(['', 'garbage', 'a.b', 'x|y|z'])('refuses %j as malformed', (token) => {
      const verified = makeService().verify(token, at(0))

      expect(!verified.ok && verified.error.code).toBe('guestToken.malformed')
    })
  })
}
