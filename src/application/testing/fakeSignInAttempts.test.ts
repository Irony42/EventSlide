import { describe, expect, it } from 'vitest'
import { signInAttemptsContract } from './contracts/signInAttemptsContract'
import { FakeSignInAttempts } from './fakeSignInAttempts'

signInAttemptsContract('fake', () => new FakeSignInAttempts())

describe('FakeSignInAttempts', () => {
  it('says how many attempts a sign-in is holding', () => {
    const attempts = new FakeSignInAttempts()
    attempts.begin('a-sign-in')
    attempts.begin('a-sign-in')
    attempts.release('a-sign-in')

    expect(attempts.held('a-sign-in')).toBe(1)
    expect(attempts.held('another')).toBe(0)
  })
})
