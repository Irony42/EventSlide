import { describe, expect, it } from 'vitest'
import type { SignInAttempts } from '../../ports/signInAttempts'

/**
 * The shared `SignInAttempts` contract, run against the in-memory fake and the in-process
 * adapter.
 *
 * What has to behave the same is the arithmetic the second-factor cap is built on: **every
 * `begin` is given its own number, in order, per sign-in**. A fake that handed two callers the
 * same number would let every use-case test pass against a counter that cannot count.
 */

export const signInAttemptsContract = (name: string, makeAttempts: () => SignInAttempts): void => {
  describe(`SignInAttempts contract: ${name}`, () => {
    it('numbers the attempts of one sign-in from one, each taking the next', () => {
      const attempts = makeAttempts()

      expect([1, 2, 3].map(() => attempts.begin('a-sign-in'))).toEqual([1, 2, 3])
    })

    it('counts each sign-in on its own', () => {
      const attempts = makeAttempts()
      attempts.begin('one')
      attempts.begin('one')

      expect(attempts.begin('another')).toBe(1)
      expect(attempts.begin('one')).toBe(3)
    })

    it('gives an attempt back, so the next one takes its number', () => {
      const attempts = makeAttempts()
      attempts.begin('a-sign-in')
      attempts.begin('a-sign-in')

      attempts.release('a-sign-in')

      expect(attempts.begin('a-sign-in')).toBe(2)
    })

    it('never gives back more than it was given', () => {
      const attempts = makeAttempts()
      attempts.begin('a-sign-in')

      attempts.release('a-sign-in')
      attempts.release('a-sign-in')
      attempts.release('never-heard-of')

      expect(attempts.begin('a-sign-in')).toBe(1)
      expect(attempts.begin('never-heard-of')).toBe(1)
    })
  })
}
