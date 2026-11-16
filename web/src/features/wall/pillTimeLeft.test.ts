import { describe, expect, it } from 'vitest'
import { msUntilPillLabelChanges, pillTimeLeft } from './pillTimeLeft'

describe('the time left on a discreet announcement’s pill (spec 21)', () => {
  it('rounds up to the minute above, so it never promises less than there is', () => {
    expect(pillTimeLeft(12 * 60_000)).toEqual({ kind: 'minutes', minutes: 12 })
    expect(pillTimeLeft(11 * 60_000 + 1)).toEqual({ kind: 'minutes', minutes: 12 })
    expect(pillTimeLeft(11 * 60_000)).toEqual({ kind: 'minutes', minutes: 11 })
    expect(pillTimeLeft(120_000)).toEqual({ kind: 'minutes', minutes: 2 })
    expect(pillTimeLeft(60_001)).toEqual({ kind: 'minutes', minutes: 2 })
  })

  it('says "less than a minute" in the last minute, and never "1 min"', () => {
    expect(pillTimeLeft(60_000)).toEqual({ kind: 'lastMinute' })
    expect(pillTimeLeft(59_999)).toEqual({ kind: 'lastMinute' })
    expect(pillTimeLeft(1)).toEqual({ kind: 'lastMinute' })
  })

  it('names the instant the label changes: at the minute boundary below it', () => {
    expect(msUntilPillLabelChanges(12 * 60_000)).toBe(60_000)
    expect(msUntilPillLabelChanges(11 * 60_000 + 25_000)).toBe(25_000)
    expect(msUntilPillLabelChanges(60_001)).toBe(1)
    expect(msUntilPillLabelChanges(120_000)).toBe(60_000)
  })

  it('has no further change in the last minute', () => {
    expect(msUntilPillLabelChanges(60_000)).toBeNull()
    expect(msUntilPillLabelChanges(10)).toBeNull()
  })

  it('changes the label exactly when the delay says it does', () => {
    for (const remaining of [5 * 60_000, 4 * 60_000 + 17_000, 2 * 60_000 + 1, 90_000]) {
      const delay = msUntilPillLabelChanges(remaining)
      if (delay === null) throw new Error('expected a delay')
      expect(pillTimeLeft(remaining - delay + 1)).toEqual(pillTimeLeft(remaining))
      expect(pillTimeLeft(remaining - delay)).not.toEqual(pillTimeLeft(remaining))
    }
  })
})
