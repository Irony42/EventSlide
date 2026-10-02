import { describe, expect, it } from 'vitest'
import {
  MAX_SECOND_FACTOR_ATTEMPTS,
  PENDING_SECOND_FACTOR_LIFETIME_MS,
  STEP_UP_LIFETIME_MS,
  isStampFresh,
} from './secondFactor'

describe('the second-factor lifetimes', () => {
  it('are five minutes each, and five wrong codes', () => {
    expect(STEP_UP_LIFETIME_MS).toBe(300_000)
    expect(PENDING_SECOND_FACTOR_LIFETIME_MS).toBe(300_000)
    expect(MAX_SECOND_FACTOR_ATTEMPTS).toBe(5)
  })
})

describe('isStampFresh', () => {
  const now = 1_000_000
  const lifetime = 300_000

  it('accepts a stamp made just now and one made exactly a lifetime ago', () => {
    expect(isStampFresh(now, now, lifetime)).toBe(true)
    expect(isStampFresh(now - lifetime, now, lifetime)).toBe(true)
  })

  it('refuses a stamp older than the lifetime, by one millisecond', () => {
    expect(isStampFresh(now - lifetime - 1, now, lifetime)).toBe(false)
  })

  it('refuses a stamp in the future: a clock that stepped back must not stretch the window', () => {
    expect(isStampFresh(now + 1, now, lifetime)).toBe(false)
  })

  it.each([undefined, null, '1000000', Number.NaN, Number.POSITIVE_INFINITY, {}])(
    'refuses %j, which is not a stamp the server wrote',
    (value) => {
      expect(isStampFresh(value, now, lifetime)).toBe(false)
    },
  )
})
