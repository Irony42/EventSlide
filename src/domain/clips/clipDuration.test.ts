import { describe, expect, it } from 'vitest'
import { ClipDuration } from './clipDuration'

const MAX = 15_000

describe('ClipDuration', () => {
  it('accepts a clip inside the cap', () => {
    const result = ClipDuration.create(7_400, MAX)
    expect(result.ok && result.value.ms).toBe(7_400)
  })

  it('accepts a clip exactly at the cap', () => {
    expect(ClipDuration.create(MAX, MAX).ok).toBe(true)
  })

  it('accepts a clip exactly at the floor', () => {
    expect(ClipDuration.create(ClipDuration.minMs, MAX).ok).toBe(true)
  })

  it('refuses a clip one millisecond past the cap', () => {
    const result = ClipDuration.create(MAX + 1, MAX)
    expect(!result.ok && result.error.code).toBe('clip.tooLong')
  })

  it('refuses a container too short to be a clip at all', () => {
    const result = ClipDuration.create(ClipDuration.minMs - 1, MAX)
    expect(!result.ok && result.error.code).toBe('clip.tooShort')
  })

  it('refuses a duration the container did not declare', () => {
    // ffprobe answers `N/A` for a container whose header was never finalised, and the
    // adapter turns that into NaN rather than guessing a number.
    const result = ClipDuration.create(Number.NaN, MAX)
    expect(!result.ok && result.error.code).toBe('clip.durationUnknown')
  })

  it('refuses a negative duration rather than taking its magnitude', () => {
    const result = ClipDuration.create(-4_000, MAX)
    expect(!result.ok && result.error.code).toBe('clip.durationUnknown')
  })

  it('rounds a fractional millisecond count to a whole one', () => {
    const result = ClipDuration.create(6_500.6, MAX)
    expect(result.ok && result.value.ms).toBe(6_501)
  })

  it('rounds seconds up, so a 5.4 second clip is not reported as five', () => {
    const result = ClipDuration.create(5_400, MAX)
    expect(result.ok && result.value.seconds).toBe(6)
  })

  it('compares by value', () => {
    const one = ClipDuration.create(6_000, MAX)
    const other = ClipDuration.create(6_000, MAX)
    const longer = ClipDuration.create(9_000, MAX)
    expect(one.ok && other.ok && one.value.equals(other.value)).toBe(true)
    expect(one.ok && longer.ok && one.value.equals(longer.value)).toBe(false)
  })
})
