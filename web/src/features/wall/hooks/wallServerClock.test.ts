import { describe, expect, it } from 'vitest'
import { createWallServerClock } from './wallServerClock'

describe('the wall server clock', () => {
  it('answers the machine clock before the first reading', () => {
    expect(createWallServerClock({ monotonic: () => 5, local: () => 777 }).now()).toBe(777)
  })

  it('reads the stamp at the middle of the round trip, then advances with the monotonic clock', () => {
    let monotonic = 100
    const clock = createWallServerClock({ monotonic: () => monotonic, local: () => 0 })
    clock.sync(50_000, 90, 110)
    expect(clock.now()).toBe(50_000)
    monotonic = 4_100
    expect(clock.now()).toBe(54_000)
  })

  it('takes the latest reading', () => {
    let monotonic = 0
    const clock = createWallServerClock({ monotonic: () => monotonic, local: () => 0 })
    clock.sync(1_000, 0, 0)
    monotonic = 10
    clock.sync(9_000, 10, 10)
    expect(clock.now()).toBe(9_000)
  })

  it('uses performance.now by default', () => {
    const clock = createWallServerClock()
    clock.sync(1_000, 0, 0)
    expect(clock.now()).toBeGreaterThanOrEqual(1_000)
  })
})
