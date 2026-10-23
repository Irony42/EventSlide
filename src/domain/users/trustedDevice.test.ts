import { describe, expect, it } from 'vitest'
import { TRUSTED_DEVICE_LIFETIME_MS, isTrustedDevice } from './trustedDevice'

const NOW = 1_800_000_000_000
const DAY = 24 * 60 * 60_000

/** A device that signed in a day ago, to an account that is switched on and never changed. */
const facts = (
  overrides: Partial<Parameters<typeof isTrustedDevice>[0]> = {},
): Parameters<typeof isTrustedDevice>[0] => ({
  issuedAtMs: NOW - DAY,
  nowMs: NOW,
  accountActive: true,
  credentialsChangedAtMs: null,
  ...overrides,
})

describe('a trusted device', () => {
  it('is trusted when it signed in recently, to a live account whose credentials never changed', () => {
    expect(isTrustedDevice(facts())).toBe(true)
  })

  it('is trusted for ninety days from its sign-in, and not a millisecond longer', () => {
    expect(TRUSTED_DEVICE_LIFETIME_MS).toBe(90 * DAY)

    expect(isTrustedDevice(facts({ issuedAtMs: NOW - TRUSTED_DEVICE_LIFETIME_MS + 1 }))).toBe(true)
    expect(isTrustedDevice(facts({ issuedAtMs: NOW - TRUSTED_DEVICE_LIFETIME_MS }))).toBe(false)
    expect(isTrustedDevice(facts({ issuedAtMs: NOW - 400 * DAY }))).toBe(false)
  })

  it('is trusted the instant it is issued', () => {
    expect(isTrustedDevice(facts({ issuedAtMs: NOW }))).toBe(true)
  })

  it('is not trusted when it claims to come from the future: the server wrote the stamp, so the clock moved', () => {
    expect(isTrustedDevice(facts({ issuedAtMs: NOW + 1 }))).toBe(false)
    expect(isTrustedDevice(facts({ issuedAtMs: NOW + 365 * DAY }))).toBe(false)
  })

  it('is not trusted when the stamp is not a number at all', () => {
    expect(isTrustedDevice(facts({ issuedAtMs: Number.NaN }))).toBe(false)
    expect(isTrustedDevice(facts({ issuedAtMs: Number.NEGATIVE_INFINITY }))).toBe(false)
  })

  it('is not trusted once the credentials changed after it was issued: a password change, a reset, "sign out everywhere"', () => {
    const issuedAtMs = NOW - 10 * DAY

    expect(isTrustedDevice(facts({ issuedAtMs, credentialsChangedAtMs: issuedAtMs + 1 }))).toBe(
      false,
    )
    expect(isTrustedDevice(facts({ issuedAtMs, credentialsChangedAtMs: NOW - DAY }))).toBe(false)
  })

  it('is trusted again by a sign-in that came after the change, and by one in the very same instant', () => {
    const changedAt = NOW - 5 * DAY

    expect(
      isTrustedDevice(facts({ issuedAtMs: changedAt + 1, credentialsChangedAtMs: changedAt })),
    ).toBe(true)
    expect(
      isTrustedDevice(facts({ issuedAtMs: changedAt, credentialsChangedAtMs: changedAt })),
    ).toBe(true)
  })

  it('is not trusted by an account that is switched off, or gone: a device cannot outlive its account', () => {
    expect(isTrustedDevice(facts({ accountActive: false }))).toBe(false)
  })
})
