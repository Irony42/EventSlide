import { createHmac, timingSafeEqual } from 'node:crypto'
import type { GuestTokenClaims, GuestTokenService } from '../../application/ports/guestTokenService'
import { DomainError } from '../../domain/shared/errors'
import { err, ok, type Result } from '../../domain/shared/result'
import { asEventId, asGuestId } from '../../domain/shared/ids'

/**
 * The guest device token: `v1.<payload>.<mac>`, all base64url.
 *
 * A signed statement, not an encrypted one. The payload is readable by whoever holds
 * the cookie, and that is fine — it says "guest 4f2… of event 91a…", which the holder
 * already knows. What matters is that they cannot change it, and cannot mint one for
 * another event.
 *
 * Why not a JWT: a JWT would bring an algorithm field the verifier has to be careful
 * not to trust, a library, and a specification's worth of options for two claims and a
 * timestamp. Forty lines with one hard-coded algorithm has no `alg: none` to get wrong.
 */

const VERSION = 'v1'
const SEPARATOR = '.'
/** A wedding runs long; a token issued at the aperitif must still work at 2 a.m. */
const DEFAULT_MAX_AGE_MS = 36 * 60 * 60 * 1000

interface TokenPayload {
  readonly e: string
  readonly g: string
  /** Issued-at, epoch milliseconds. */
  readonly i: number
}

const base64url = (input: Buffer): string => input.toString('base64url')

const isTokenPayload = (value: unknown): value is TokenPayload => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate['e'] === 'string' &&
    candidate['e'].length > 0 &&
    typeof candidate['g'] === 'string' &&
    candidate['g'].length > 0 &&
    typeof candidate['i'] === 'number' &&
    Number.isFinite(candidate['i'])
  )
}

export interface GuestTokenOptions {
  readonly secret: string
  readonly maxAgeMs?: number
}

export const createHmacGuestTokenService = ({
  secret,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
}: GuestTokenOptions): GuestTokenService => {
  if (secret.length < 32) {
    throw new Error('GUEST_TOKEN_SECRET must be at least 32 characters')
  }

  const sign = (payload: string): string =>
    base64url(createHmac('sha256', secret).update(`${VERSION}.${payload}`).digest())

  return {
    issue: ({ eventId, guestId, issuedAt }: GuestTokenClaims): string => {
      const payload: TokenPayload = { e: eventId, g: guestId, i: issuedAt.getTime() }
      const encoded = base64url(Buffer.from(JSON.stringify(payload), 'utf8'))
      return [VERSION, encoded, sign(encoded)].join(SEPARATOR)
    },

    verify: (token: string, now: Date): Result<GuestTokenClaims, DomainError> => {
      const parts = token.split(SEPARATOR)
      if (parts.length !== 3) return err(DomainError.unauthenticated('guestToken.malformed'))

      const [version, encoded, mac] = parts
      if (version !== VERSION || !encoded || !mac) {
        return err(DomainError.unauthenticated('guestToken.malformed'))
      }

      // Compare before parsing. An attacker must not be able to reach the JSON parser,
      // or the id lookups behind it, with a payload they forged.
      const expected = Buffer.from(sign(encoded), 'utf8')
      const provided = Buffer.from(mac, 'utf8')
      if (
        expected.length !== provided.length ||
        !timingSafeEqual(new Uint8Array(expected), new Uint8Array(provided))
      ) {
        return err(DomainError.unauthenticated('guestToken.badSignature'))
      }

      let payload: unknown
      try {
        payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
      } catch {
        // Reachable only with a valid MAC over invalid JSON, so this means our own
        // issuer wrote something wrong rather than an attack.
        return err(DomainError.unauthenticated('guestToken.malformed'))
      }
      if (!isTokenPayload(payload)) {
        return err(DomainError.unauthenticated('guestToken.malformed'))
      }

      const age = now.getTime() - payload.i
      // A negative age means the token claims to be from the future: clock skew
      // between the server and nothing at all, since the server issued it. Treat it as
      // expired rather than accepting a token that could outlive its window.
      if (age < 0 || age > maxAgeMs) {
        return err(DomainError.unauthenticated('guestToken.expired'))
      }

      return ok({
        eventId: asEventId(payload.e),
        guestId: asGuestId(payload.g),
        issuedAt: new Date(payload.i),
      })
    },
  }
}
