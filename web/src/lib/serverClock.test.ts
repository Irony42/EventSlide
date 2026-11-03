import { describe, expect, it } from 'vitest'
import { createServerClock, serverOffsetMs } from './serverClock'

describe('the server clock', () => {
  it('reads the stamp at the middle of the round trip', () => {
    expect(serverOffsetMs(10_000, 100, 300)).toBe(9_800)
  })

  it('knows nothing before the first reading', () => {
    expect(createServerClock({ monotonic: () => 5 }).now()).toBeNull()
  })

  it('advances with the monotonic clock, not the machine date', () => {
    let monotonic = 100
    const clock = createServerClock({ monotonic: () => monotonic })
    clock.sync(50_000, 90, 110)
    expect(clock.now()).toBe(50_000)
    monotonic = 4_100
    expect(clock.now()).toBe(54_000)
  })

  it('takes the latest reading', () => {
    let monotonic = 0
    const clock = createServerClock({ monotonic: () => monotonic })
    clock.sync(1_000, 0, 0)
    monotonic = 10
    clock.sync(9_000, 10, 10)
    expect(clock.now()).toBe(9_000)
  })

  it('uses performance.now by default', () => {
    const clock = createServerClock()
    clock.sync(1_000, 0, 0)
    expect(clock.now()).toBeGreaterThanOrEqual(1_000)
  })
})
