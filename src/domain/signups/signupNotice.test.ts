import { describe, expect, it } from 'vitest'
import { SIGNUP_NOTICE_MIN_INTERVAL_MS, signupNoticeDue } from './signupNotice'

const T0 = new Date('2026-11-27T10:00:00.000Z')
const after = (ms: number): Date => new Date(T0.getTime() + ms)

describe('signupNoticeDue', () => {
  it('is due when nothing was ever sent', () => {
    expect(signupNoticeDue(null, T0)).toBe(true)
  })

  it('is not due one millisecond before the hour is up', () => {
    expect(signupNoticeDue(T0, after(SIGNUP_NOTICE_MIN_INTERVAL_MS - 1))).toBe(false)
  })

  it('is due exactly one hour after the last one', () => {
    expect(signupNoticeDue(T0, after(SIGNUP_NOTICE_MIN_INTERVAL_MS))).toBe(true)
  })
})
