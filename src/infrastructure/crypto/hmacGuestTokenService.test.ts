import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createHmacGuestTokenService } from './hmacGuestTokenService'
import { asEventId, asGuestId } from '../../domain/shared/ids'

const SECRET = 'a-test-secret-that-is-at-least-32-characters-long'
const OTHER_SECRET = 'a-different-secret-also-at-least-32-characters'

const service = createHmacGuestTokenService({ secret: SECRET })

const claims = {
  eventId: asEventId('event-1'),
  guestId: asGuestId('guest-1'),
  issuedAt: new Date('2026-06-20T21:00:00.000Z'),
}

/**
 * Mints a token with a genuinely valid MAC over an arbitrary payload. Needed to reach
 * the checks that sit *after* signature verification — an attacker without the secret
 * cannot get there, which is the point, so the test has to hold the secret.
 */
const signedToken = (payloadJson: string, secret = SECRET): string => {
  const encoded = Buffer.from(payloadJson, 'utf8').toString('base64url')
  const mac = createHmac('sha256', secret).update(`v1.${encoded}`).digest('base64url')
  return `v1.${encoded}.${mac}`
}

describe('hmacGuestTokenService', () => {
  it('round-trips the claims it was given', () => {
    const token = service.issue(claims)

    const result = service.verify(token, new Date('2026-06-20T22:00:00.000Z'))

    expect(result.ok).toBe(true)
    expect(result.ok && result.value).toEqual(claims)
  })

  it('refuses to be constructed with a short secret', () => {
    expect(() => createHmacGuestTokenService({ secret: 'too-short' })).toThrow(
      /at least 32 characters/,
    )
  })

  it('rejects a token signed with a different secret', () => {
    const foreign = createHmacGuestTokenService({ secret: OTHER_SECRET }).issue(claims)

    const result = service.verify(foreign, claims.issuedAt)

    expect(!result.ok && result.error.code).toBe('guestToken.badSignature')
  })

  it('rejects a payload edited to name another event, which is the attack this prevents', () => {
    const token = service.issue(claims)
    const mac = token.split('.')[2]
    const forgedPayload = Buffer.from(
      JSON.stringify({ e: 'someone-elses-event', g: 'guest-1', i: claims.issuedAt.getTime() }),
      'utf8',
    ).toString('base64url')

    const result = service.verify(`v1.${forgedPayload}.${mac}`, claims.issuedAt)

    expect(!result.ok && result.error.code).toBe('guestToken.badSignature')
  })

  it('verifies the signature before parsing, so a hostile payload never reaches JSON.parse', () => {
    const notJson = Buffer.from('{{{ not json', 'utf8').toString('base64url')

    const result = service.verify(`v1.${notJson}.forged-mac`, claims.issuedAt)

    expect(!result.ok && result.error.code).toBe('guestToken.badSignature')
  })

  it.each([
    ['no separators', 'not-a-token'],
    ['two parts only', 'v1.abc'],
    ['four parts', 'v1.abc.def.ghi'],
    ['empty payload', 'v1..mac'],
    ['empty mac', 'v1.abc.'],
    ['unknown version', 'v2.abc.def'],
  ])('rejects a malformed token: %s', (_label, token) => {
    const result = service.verify(token, claims.issuedAt)

    expect(!result.ok && result.error.code).toBe('guestToken.malformed')
  })

  it.each([
    ['a JSON string', '"just-a-string"'],
    ['an array', '[1,2,3]'],
    ['null', 'null'],
    ['a missing guest id', '{"e":"event-1","i":1781038800000}'],
    ['an empty event id', '{"e":"","g":"guest-1","i":1781038800000}'],
    ['a non-numeric issued-at', '{"e":"event-1","g":"guest-1","i":"yesterday"}'],
    ['an infinite issued-at', '{"e":"event-1","g":"guest-1","i":1e999}'],
  ])('rejects a correctly signed token whose payload is %s', (_label, payloadJson) => {
    const result = service.verify(signedToken(payloadJson), claims.issuedAt)

    expect(!result.ok && result.error.code).toBe('guestToken.malformed')
  })

  it('rejects a correctly signed token that is not valid JSON at all', () => {
    const result = service.verify(signedToken('{{{ not json'), claims.issuedAt)

    expect(!result.ok && result.error.code).toBe('guestToken.malformed')
  })

  it('rejects a token past its maximum age', () => {
    const shortLived = createHmacGuestTokenService({ secret: SECRET, maxAgeMs: 1_000 })
    const token = shortLived.issue(claims)

    const result = shortLived.verify(token, new Date(claims.issuedAt.getTime() + 1_001))

    expect(!result.ok && result.error.code).toBe('guestToken.expired')
  })

  it('accepts a token at exactly its maximum age', () => {
    const shortLived = createHmacGuestTokenService({ secret: SECRET, maxAgeMs: 1_000 })
    const token = shortLived.issue(claims)

    const result = shortLived.verify(token, new Date(claims.issuedAt.getTime() + 1_000))

    expect(result.ok).toBe(true)
  })

  it('rejects a token that claims to have been issued in the future', () => {
    const token = service.issue(claims)

    const result = service.verify(token, new Date(claims.issuedAt.getTime() - 1))

    expect(!result.ok && result.error.code).toBe('guestToken.expired')
  })

  it('lasts long enough for a wedding by default', () => {
    const token = service.issue(claims)
    const nextMorning = new Date(claims.issuedAt.getTime() + 12 * 60 * 60 * 1000)

    expect(service.verify(token, nextMorning).ok).toBe(true)
  })

  it('issues distinct tokens for two guests at the same event', () => {
    const first = service.issue(claims)
    const second = service.issue({ ...claims, guestId: asGuestId('guest-2') })

    expect(first).not.toBe(second)
  })

  it('reports every failure as unauthenticated, so the HTTP layer answers 401', () => {
    const result = service.verify('garbage', claims.issuedAt)

    expect(!result.ok && result.error.kind).toBe('unauthenticated')
  })
})
