import { describe, expect, it } from 'vitest'
import { POLL_EVERY_MS, POLL_SLOW_EVERY_MS, pollDelayMs } from './pollCadence'

describe('the wait between two reads of a guest whose photo is waiting', () => {
  it('is spread around the cadence, so phones that started together stop asking together', () => {
    const earliest = pollDelayMs(false, () => 0)
    const latest = pollDelayMs(false, () => 1)

    expect(earliest).toBeLessThan(POLL_EVERY_MS)
    expect(latest).toBeGreaterThan(POLL_EVERY_MS)
    // A second or two either way: enough to scatter a room, not enough to make the
    // announcement late.
    expect(POLL_EVERY_MS - earliest).toBeLessThanOrEqual(2_000)
    expect(latest - POLL_EVERY_MS).toBeLessThanOrEqual(2_000)
  })

  it('is the cadence itself when the draw lands in the middle', () => {
    expect(pollDelayMs(false, () => 0.5)).toBe(POLL_EVERY_MS)
    expect(pollDelayMs(true, () => 0.5)).toBe(POLL_SLOW_EVERY_MS)
  })

  it('is spread around the slow cadence too, once the host has plainly left it', () => {
    expect(pollDelayMs(true, () => 0)).toBeLessThan(POLL_SLOW_EVERY_MS)
    expect(pollDelayMs(true, () => 1)).toBeGreaterThan(POLL_SLOW_EVERY_MS)
  })
})
