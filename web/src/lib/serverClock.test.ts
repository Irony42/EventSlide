import { describe, expect, it } from 'vitest'
import { formatCountdown, remainingMs, serverNowFrom, serverOffsetMs } from './serverClock'

describe('serverOffsetMs', () => {
  it('is zero when the two clocks agree and the round trip was instant', () => {
    expect(serverOffsetMs(10_000, 10_000, 10_000)).toBe(0)
  })

  it('corrects by half the round trip', () => {
    // Sent at 10 000, back at 10 400: the server answered around 10 200 on this machine's clock.
    expect(serverOffsetMs(50_200, 10_000, 10_400)).toBe(40_000)
  })

  it('is negative for a machine whose clock runs ahead', () => {
    expect(serverOffsetMs(10_000, 190_000, 190_000)).toBe(-180_000)
  })
})

describe('remainingMs', () => {
  const ENDS = 1_000_000

  it('shows the same time on a machine three minutes ahead as on one that is right', () => {
    const right = remainingMs(ENDS, 940_000, serverOffsetMs(940_000, 940_000, 940_000))
    const ahead = remainingMs(ENDS, 1_120_000, serverOffsetMs(940_000, 1_120_000, 1_120_000))

    expect(right).toBe(60_000)
    expect(ahead).toBe(60_000)
  })

  it('never goes negative', () => {
    expect(remainingMs(ENDS, 2_000_000, 0)).toBe(0)
  })

  it('applies the offset to the local clock', () => {
    expect(serverNowFrom(100, 25)).toBe(125)
  })
})

describe('formatCountdown', () => {
  it.each([
    [102_000, '1:42'],
    [60_000, '1:00'],
    [59_001, '1:00'],
    [9_000, '0:09'],
    [1, '0:01'],
    [0, '0:00'],
    [-5, '0:00'],
    [600_000, '10:00'],
  ])('writes %i ms as %s', (ms, text) => {
    expect(formatCountdown(ms)).toBe(text)
  })
})
