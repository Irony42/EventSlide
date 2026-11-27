import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SIGNUP_MODE,
  SIGNUP_MODES,
  isSignupMode,
  missingSignupPrerequisites,
  signupEnabled,
  signupOpensAccounts,
} from './signupMode'

describe('signup mode', () => {
  it('is off by default, so a box that sets nothing changes nothing', () => {
    expect(DEFAULT_SIGNUP_MODE).toBe('off')
  })

  it.each(SIGNUP_MODES)('recognises %s', (mode) => {
    expect(isSignupMode(mode)).toBe(true)
  })

  it.each(['', 'on', 'OPEN', 3, null, undefined])('refuses %s', (value) => {
    expect(isSignupMode(value)).toBe(false)
  })

  it('has a form in review and open, not in off', () => {
    expect(SIGNUP_MODES.map(signupEnabled)).toEqual([false, true, true])
  })

  it('opens accounts by itself only in open', () => {
    expect(SIGNUP_MODES.map(signupOpensAccounts)).toEqual([false, false, true])
  })

  describe('missingSignupPrerequisites', () => {
    const none = { siteAdmin: false, mailDelivers: false }

    it('asks nothing of off', () => {
      expect(missingSignupPrerequisites('off', none)).toEqual([])
    })

    it.each(['review', 'open'] as const)('asks the site role and a mailer of %s', (mode) => {
      expect(missingSignupPrerequisites(mode, none)).toEqual(['siteAdmin', 'mail'])
    })

    it('names only what is missing', () => {
      expect(missingSignupPrerequisites('open', { siteAdmin: true, mailDelivers: false })).toEqual([
        'mail',
      ])
      expect(
        missingSignupPrerequisites('review', { siteAdmin: false, mailDelivers: true }),
      ).toEqual(['siteAdmin'])
    })

    it('is satisfied when both are there', () => {
      expect(missingSignupPrerequisites('open', { siteAdmin: true, mailDelivers: true })).toEqual(
        [],
      )
    })
  })
})
