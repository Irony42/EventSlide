import { describe, expect, it } from 'vitest'
import { signInAttemptsContract } from '../../application/testing/contracts/signInAttemptsContract'
import { FakeClock } from '../../application/testing/fakeClock'
import { createInMemorySignInAttempts } from './inMemorySignInAttempts'

const TTL_MS = 5 * 60 * 1000

signInAttemptsContract('in memory', () =>
  createInMemorySignInAttempts({ clock: new FakeClock(), ttlMs: TTL_MS }),
)

describe('createInMemorySignInAttempts: forgetting', () => {
  it('still counts a sign-in at the very end of its time', () => {
    const clock = new FakeClock()
    const attempts = createInMemorySignInAttempts({ clock, ttlMs: TTL_MS })
    attempts.begin('a-sign-in')

    clock.advance(TTL_MS)

    expect(attempts.begin('a-sign-in')).toBe(2)
  })

  it('forgets a sign-in one millisecond after its time, so the next one starts again from one', () => {
    const clock = new FakeClock()
    const attempts = createInMemorySignInAttempts({ clock, ttlMs: TTL_MS })
    attempts.begin('a-sign-in')
    attempts.begin('a-sign-in')

    clock.advance(TTL_MS + 1)

    expect(attempts.begin('a-sign-in')).toBe(1)
  })

  it('forgets the old sign-ins and keeps the young ones, whatever order they are asked in', () => {
    const clock = new FakeClock()
    const attempts = createInMemorySignInAttempts({ clock, ttlMs: TTL_MS })
    attempts.begin('old')
    clock.advance(TTL_MS - 1000)
    attempts.begin('young')
    clock.advance(2000)

    expect(attempts.begin('young')).toBe(2)
    expect(attempts.begin('old')).toBe(1)
  })
})
