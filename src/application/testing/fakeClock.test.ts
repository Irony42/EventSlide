import { describe, expect, it } from 'vitest'
import { AT, atPlus } from './builders'
import { FakeClock } from './fakeClock'

describe('FakeClock', () => {
  it('starts at the instant it was given', async () => {
    expect(new FakeClock(atPlus(1_000)).now().toISOString()).toBe(atPlus(1_000).toISOString())
  })

  it('starts at the shared fixture instant by default', async () => {
    expect(new FakeClock().now().toISOString()).toBe(AT.toISOString())
  })

  it('moves forward by the given number of milliseconds', async () => {
    const clock = new FakeClock(AT)

    clock.advance(90_000)

    expect(clock.now().toISOString()).toBe(atPlus(90_000).toISOString())
  })

  it('accumulates successive advances', async () => {
    const clock = new FakeClock(AT)

    clock.advance(1_000).advance(2_000)

    expect(clock.now().toISOString()).toBe(atPlus(3_000).toISOString())
  })

  it('moves backwards when a test needs to reach a past deadline', async () => {
    const clock = new FakeClock(AT)

    clock.advance(-1_000)

    expect(clock.now().toISOString()).toBe(atPlus(-1_000).toISOString())
  })

  it('jumps to an absolute instant', async () => {
    const clock = new FakeClock(AT)

    clock.set(atPlus(86_400_000))

    expect(clock.now().toISOString()).toBe(atPlus(86_400_000).toISOString())
  })

  it('refuses an advance that is not a number of milliseconds', async () => {
    expect(() => new FakeClock(AT).advance(Number.NaN)).toThrow()
  })

  it('hands out a copy, so a caller cannot move the clock by mutating a reading', async () => {
    const clock = new FakeClock(AT)

    clock.now().setTime(0)

    expect(clock.now().toISOString()).toBe(AT.toISOString())
  })

  it('does not follow the instant it was constructed from', async () => {
    const start = new Date(AT.getTime())
    const clock = new FakeClock(start)

    start.setTime(0)

    expect(clock.now().toISOString()).toBe(AT.toISOString())
  })
})
