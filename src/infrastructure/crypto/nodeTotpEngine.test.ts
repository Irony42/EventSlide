import { describe, expect, it } from 'vitest'
import { totpEngineContract } from '../../application/testing/contracts/totpEngineContract'
import { totpStepAt } from '../../domain/users/totp'
import { hotp, nodeTotpEngine } from './nodeTotpEngine'

/**
 * Ring 3. The adapter is held to the vectors the two RFCs publish, because that is the only
 * proof that a code this server accepts is the code an authenticator app shows.
 */

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text)

/** RFC 4226 Appendix D: the key `12345678901234567890`, counters 0 to 9, six digits. */
const RFC_4226_APPENDIX_D = [
  '755224',
  '287082',
  '359152',
  '969429',
  '338314',
  '254676',
  '287922',
  '162583',
  '399871',
  '520489',
] as const

/**
 * RFC 6238 Appendix B, the SHA-1 column: `[time in seconds, step, 8-digit TOTP]`. The RFC
 * publishes eight digits; the product uses six, which are the last six (the code is the same
 * 31-bit number reduced modulo a smaller power of ten).
 */
const RFC_6238_APPENDIX_B: readonly (readonly [number, number, string])[] = [
  [59, 0x0000000000000001, '94287082'],
  [1111111109, 0x00000000023523ec, '07081804'],
  [1111111111, 0x00000000023523ed, '14050471'],
  [1234567890, 0x000000000273ef07, '89005924'],
  [2000000000, 0x0000000003f940aa, '69279037'],
  [20000000000, 0x0000000027bc86aa, '65353130'],
]

const SECRET = ascii('12345678901234567890')

describe('hotp (RFC 4226)', () => {
  it.each(RFC_4226_APPENDIX_D.map((code, counter) => [counter, code] as const))(
    'gives the Appendix D code for counter %i',
    (counter, expected) => {
      expect(hotp(SECRET, counter, 6)).toBe(expected)
    },
  )

  it('keeps the leading zeros of a code', () => {
    expect(hotp(SECRET, 0x23523ec, 8)).toBe('07081804')
  })

  it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'refuses %s as a counter rather than hash a wrong one',
    (counter) => {
      expect(() => hotp(SECRET, counter, 6)).toThrow(RangeError)
    },
  )
})

describe('nodeTotpEngine (RFC 6238 Appendix B)', () => {
  it.each(RFC_6238_APPENDIX_B)(
    'at T = %i (step %i) the 8-digit code is %s',
    (seconds, step, eightDigits) => {
      expect(totpStepAt(new Date(seconds * 1000))).toBe(step)
      expect(hotp(SECRET, step, 8)).toBe(eightDigits)
    },
  )

  it.each(RFC_6238_APPENDIX_B)(
    'at T = %i the six digits the product uses are the last six of %s',
    (_seconds, step, eightDigits) => {
      expect(nodeTotpEngine.codeAt(SECRET, step)).toBe(eightDigits.slice(2))
    },
  )

  it('answers six digits, whatever the step', () => {
    for (const step of [0, 1, 99, 56_000_000]) {
      expect(nodeTotpEngine.codeAt(SECRET, step)).toMatch(/^\d{6}$/)
    }
  })

  it('gives a different code to a different secret', () => {
    expect(nodeTotpEngine.codeAt(ascii('another secret!!!!!!'), 1)).not.toBe(
      nodeTotpEngine.codeAt(SECRET, 1),
    )
  })
})

totpEngineContract('hmac-sha1', nodeTotpEngine)
