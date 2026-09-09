import { describe, expect, it } from 'vitest'
import { SlideInterval } from './slideInterval'

describe('SlideInterval', () => {
  it('accepts the shortest interval a host may choose', () => {
    const result = SlideInterval.create(SlideInterval.minMs)

    expect(result.ok && result.value.ms).toBe(2_000)
  })

  it('accepts the longest interval a host may choose', () => {
    const result = SlideInterval.create(SlideInterval.maxMs)

    expect(result.ok && result.value.ms).toBe(600_000)
  })

  it('accepts a value between the bounds', () => {
    const result = SlideInterval.create(12_000)

    expect(result.ok && result.value.ms).toBe(12_000)
  })

  it('refuses an interval one millisecond below the minimum', () => {
    const result = SlideInterval.create(SlideInterval.minMs - 1)

    expect(!result.ok && result.error.code).toBe('slideInterval.tooShort')
  })

  it('refuses an interval one millisecond above the maximum', () => {
    const result = SlideInterval.create(SlideInterval.maxMs + 1)

    expect(!result.ok && result.error.code).toBe('slideInterval.tooLong')
  })

  it('reports an out-of-range interval as bad input rather than a conflict', () => {
    const result = SlideInterval.create(0)

    expect(!result.ok && result.error.kind).toBe('invalid')
  })

  it('tells the host what the limit was', () => {
    const result = SlideInterval.create(SlideInterval.maxMs + 1)

    expect(!result.ok && result.error.details).toEqual({ max: 600_000 })
  })

  it('refuses a fractional interval, which no slide timer can honour', () => {
    const result = SlideInterval.create(8_000.5)

    expect(!result.ok && result.error.code).toBe('slideInterval.notInteger')
  })

  it('refuses a value that is not a number at all', () => {
    const result = SlideInterval.create(Number.NaN)

    expect(!result.ok && result.error.code).toBe('slideInterval.notInteger')
  })

  it('defaults to eight seconds', () => {
    expect(SlideInterval.default().ms).toBe(8_000)
  })

  it('defaults to an interval a host could also have chosen, since default() skips create()', () => {
    const result = SlideInterval.create(SlideInterval.defaultMs)

    expect(result.ok).toBe(true)
  })

  it('exposes seconds, because the wall writes CSS durations', () => {
    expect(SlideInterval.default().seconds).toBe(8)
  })

  it('treats two intervals of the same length as the same setting', () => {
    const other = SlideInterval.create(SlideInterval.defaultMs)

    expect(other.ok && other.value.equals(SlideInterval.default())).toBe(true)
  })

  it('distinguishes two intervals of different lengths', () => {
    const other = SlideInterval.create(9_000)

    expect(other.ok && other.value.equals(SlideInterval.default())).toBe(false)
  })

  it('describes itself in milliseconds for a log line', () => {
    expect(SlideInterval.default().toString()).toBe('8000ms')
  })
})
