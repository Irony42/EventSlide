import { describe, expect, it } from 'vitest'
import { addDays, MS_PER_DAY } from './time'

describe('time', () => {
  it('counts a day as 24 hours', () => {
    expect(MS_PER_DAY).toBe(86_400_000)
  })

  it('adds whole days, forward and backward, without touching its input', () => {
    const at = new Date('2026-11-07T10:00:00.000Z')
    expect(addDays(at, 30).toISOString()).toBe('2026-12-07T10:00:00.000Z')
    expect(addDays(at, -7).toISOString()).toBe('2026-10-31T10:00:00.000Z')
    expect(addDays(at, 0).getTime()).toBe(at.getTime())
    expect(at.toISOString()).toBe('2026-11-07T10:00:00.000Z')
  })

  it('adds a fraction of a day as milliseconds', () => {
    const at = new Date('2026-11-07T00:00:00.000Z')
    expect(addDays(at, 0.5).toISOString()).toBe('2026-11-07T12:00:00.000Z')
  })
})
