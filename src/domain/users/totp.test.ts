import { describe, expect, it } from 'vitest'
import {
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  acceptableTotpSteps,
  matchTotpStep,
  otpauthUri,
  parseTotpCode,
  totpSecretText,
  totpStepAt,
} from './totp'

const at = (seconds: number): Date => new Date(seconds * 1000)

describe('totpStepAt', () => {
  it('counts whole thirty-second periods since the Unix epoch', () => {
    expect(TOTP_PERIOD_SECONDS).toBe(30)
    expect(totpStepAt(at(0))).toBe(0)
    expect(totpStepAt(at(29.999))).toBe(0)
    expect(totpStepAt(at(30))).toBe(1)
    // RFC 6238 Appendix B: T = 59 is step 1 (0x1), T = 1111111109 is 0x23523EC.
    expect(totpStepAt(at(59))).toBe(1)
    expect(totpStepAt(at(1111111109))).toBe(0x23523ec)
  })
})

describe('acceptableTotpSteps', () => {
  it('is the current step and one either side, oldest first', () => {
    expect(acceptableTotpSteps(at(300))).toEqual([9, 10, 11])
  })
})

describe('parseTotpCode', () => {
  it('accepts six digits, with or without the space an app prints in the middle', () => {
    expect(parseTotpCode('123456')).toEqual({ ok: true, value: '123456' })
    expect(parseTotpCode(' 123 456 ')).toEqual({ ok: true, value: '123456' })
  })

  it.each(['', '12345', '1234567', '12345a', '١٢٣٤٥٦', '123-456', '12.456'])(
    'refuses %j before it costs an HMAC',
    (input) => {
      const parsed = parseTotpCode(input)
      expect(!parsed.ok && parsed.error.code).toBe('auth.totpCodeInvalid')
    },
  )

  it('keeps the digit count in step with the constant the engine uses', () => {
    expect(TOTP_DIGITS).toBe(6)
  })
})

describe('matchTotpStep', () => {
  // A stand-in for the engine: the "code" of step n is n, zero-padded. What is under test is
  // the rule that judges a presented code against the steps, not the HMAC.
  const codeAt = (step: number): string => String(step).padStart(6, '0')
  const now = at(300) // step 10, so 9, 10 and 11 are acceptable.

  it('accepts the code of the current step and reports that step', () => {
    expect(matchTotpStep({ presented: codeAt(10), at: now, lastUsedStep: null, codeAt })).toBe(10)
  })

  it('accepts one step either side, for a phone whose clock is half a minute out', () => {
    expect(matchTotpStep({ presented: codeAt(9), at: now, lastUsedStep: null, codeAt })).toBe(9)
    expect(matchTotpStep({ presented: codeAt(11), at: now, lastUsedStep: null, codeAt })).toBe(11)
  })

  it('refuses a code two steps away, in either direction', () => {
    expect(matchTotpStep({ presented: codeAt(8), at: now, lastUsedStep: null, codeAt })).toBeNull()
    expect(matchTotpStep({ presented: codeAt(12), at: now, lastUsedStep: null, codeAt })).toBeNull()
  })

  it('refuses a code whose step was already used (replay)', () => {
    expect(matchTotpStep({ presented: codeAt(10), at: now, lastUsedStep: 10, codeAt })).toBeNull()
  })

  it('refuses a code for a step earlier than the last one used', () => {
    expect(matchTotpStep({ presented: codeAt(9), at: now, lastUsedStep: 10, codeAt })).toBeNull()
  })

  it('accepts a code for a step later than the last one used', () => {
    expect(matchTotpStep({ presented: codeAt(11), at: now, lastUsedStep: 10, codeAt })).toBe(11)
  })

  it('judges the matched step and not the clock: a spent code stays spent a second later', () => {
    const later = at(301)
    expect(matchTotpStep({ presented: codeAt(10), at: later, lastUsedStep: 10, codeAt })).toBeNull()
  })

  it('picks the oldest unspent step when two steps share a code', () => {
    const colliding = (step: number): string => (step === 11 ? codeAt(10) : codeAt(step))
    expect(
      matchTotpStep({ presented: codeAt(10), at: now, lastUsedStep: null, codeAt: colliding }),
    ).toBe(10)
    // And when the older of the two is spent, the newer carries the same code through.
    expect(
      matchTotpStep({ presented: codeAt(10), at: now, lastUsedStep: 10, codeAt: colliding }),
    ).toBe(11)
  })

  it('computes every acceptable step whether or not an earlier one matched', () => {
    const asked: number[] = []
    matchTotpStep({
      presented: codeAt(9),
      at: now,
      lastUsedStep: null,
      codeAt: (step) => {
        asked.push(step)
        return codeAt(step)
      },
    })
    expect(asked).toEqual([9, 10, 11])
  })

  it('refuses a code of the wrong length', () => {
    expect(matchTotpStep({ presented: '10', at: now, lastUsedStep: null, codeAt })).toBeNull()
  })
})

describe('otpauthUri', () => {
  const secret = new TextEncoder().encode('12345678901234567890')

  it('is the key-URI an authenticator app reads, with every parameter spelled out', () => {
    expect(otpauthUri({ account: 'op@example.org', issuer: 'EventSlide', secret })).toBe(
      'otpauth://totp/EventSlide:op%40example.org?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' +
        '&issuer=EventSlide&algorithm=SHA1&digits=6&period=30',
    )
  })

  it('carries the secret exactly as the enrolment response shows it for manual entry', () => {
    expect(totpSecretText(secret)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
    expect(otpauthUri({ account: 'a@b.c', issuer: 'X', secret })).toContain(
      `secret=${totpSecretText(secret)}`,
    )
  })

  it('percent-encodes the issuer and the account, and takes a colon out of the issuer', () => {
    const uri = otpauthUri({ account: 'a b@example.org', issuer: 'Photos: Les Noces', secret })
    expect(uri).toContain('otpauth://totp/Photos%20%20Les%20Noces:a%20b%40example.org?')
    expect(uri).toContain('&issuer=Photos%20%20Les%20Noces&')
  })
})
