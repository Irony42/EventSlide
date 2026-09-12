import { describe, expect, it } from 'vitest'
import { systemClock } from './systemClock'

/**
 * Ring 3, and the one place in this suite where a near-tautological test is the honest
 * one: this adapter exists precisely to be the single line in the server that calls
 * `new Date()` with no argument, so there is nothing to fake and no rule to exercise
 * beyond "it reports the real, non-decreasing wall clock". Everything that depends on
 * time is tested against `FakeClock` instead, at rings 1 and 2.
 *
 * Deliberately one test. A second would only restate it.
 */
describe('systemClock', () => {
  it('reports the real wall clock as a Date that never goes backwards', () => {
    const before = Date.now()

    const first = systemClock.now()
    const second = systemClock.now()

    expect(first).toBeInstanceOf(Date)
    expect(first.getTime()).toBeGreaterThanOrEqual(before)
    expect(second.getTime()).toBeGreaterThanOrEqual(first.getTime())
    expect(second.getTime()).toBeLessThanOrEqual(Date.now())
  })
})
