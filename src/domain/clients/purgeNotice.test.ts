import { describe, expect, it } from 'vitest'
import {
  daysLeftUntil,
  isPurgeNoticeLevel,
  nextNotice,
  noticeLevelFor,
  PURGE_NOTICE_LEVELS,
} from './purgeNotice'

/**
 * Spec 22: the three warnings, 14, 3 and 1 day before the deletion. The cases that matter are the
 * edges, because "is 14 days left a warning?" is a sentence a host was told.
 */

describe('PURGE_NOTICE_LEVELS', () => {
  it('is three constants, from the farthest to the nearest', () => {
    expect(PURGE_NOTICE_LEVELS).toEqual([14, 3, 1])
  })

  it('names the thresholds and nothing else', () => {
    expect([14, 3, 1].every(isPurgeNoticeLevel)).toBe(true)
    expect([0, 2, 7, 15, '14', null].some(isPurgeNoticeLevel)).toBe(false)
  })
})

describe('noticeLevelFor', () => {
  it.each([
    [15, null],
    [14, 14],
    [13, 14],
    [4, 14],
    [3, 3],
    [2, 3],
    [1, 1],
    [0, null],
    [-1, null],
    [Number.NaN, null],
  ])('puts %s day(s) left under the threshold %s', (daysLeft, level) => {
    expect(noticeLevelFor(daysLeft)).toBe(level)
  })
})

describe('nextNotice', () => {
  it('sends the first threshold when none has been noted', () => {
    expect(nextNotice(14, null)).toBe(14)
    expect(nextNotice(3, null)).toBe(3)
    expect(nextNotice(1, null)).toBe(1)
  })

  it('sends nothing when the album has more than 14 days left, or none', () => {
    expect(nextNotice(15, null)).toBeNull()
    expect(nextNotice(0, null)).toBeNull()
  })

  it('does not send a threshold twice', () => {
    expect(nextNotice(14, 14)).toBeNull()
    expect(nextNotice(10, 14)).toBeNull()
    expect(nextNotice(3, 3)).toBeNull()
    expect(nextNotice(1, 1)).toBeNull()
  })

  it('sends the next threshold once the album has come closer', () => {
    expect(nextNotice(3, 14)).toBe(3)
    expect(nextNotice(1, 3)).toBe(1)
    expect(nextNotice(1, 14)).toBe(1)
  })

  it('never goes back to a less urgent threshold for the same deadline', () => {
    // Same deadline: days left only shrink, so a noted level is never followed by a larger count.
    expect(nextNotice(3, 3)).toBeNull()
    expect(nextNotice(2, 3)).toBeNull()
    expect(nextNotice(10, 14)).toBeNull()
  })

  it('starts the thresholds over when the deadline has moved later than the last level noted', () => {
    // The 1-day notice went; the host reopened and re-closed: 14 days away is a new deadline.
    expect(nextNotice(14, 1)).toBe(14)
    expect(nextNotice(3, 1)).toBe(3)
    expect(nextNotice(14, 3)).toBe(14)
    expect(nextNotice(4, 3)).toBe(14)
  })

  it('sends only the most urgent threshold that applies when the date shows up late', () => {
    // An offboarding with 2 days left, a retention of 7 days: the 3, not the 14 it already passed.
    expect(nextNotice(2, null)).toBe(3)
    expect(nextNotice(1, null)).toBe(1)
  })
})

describe('daysLeftUntil', () => {
  const NOW = new Date('2026-12-01T12:00:00.000Z')
  const after = (ms: number): Date => new Date(NOW.getTime() + ms)

  it('counts whole days left, rounded up, so 20 hours is still one day', () => {
    expect(daysLeftUntil(after(20 * 3_600_000), NOW)).toBe(1)
  })

  it('counts a day exactly as one day', () => {
    expect(daysLeftUntil(after(86_400_000), NOW)).toBe(1)
  })

  it('counts a day and a second as two', () => {
    expect(daysLeftUntil(after(86_401_000), NOW)).toBe(2)
  })

  it('counts an instant that has arrived as none', () => {
    expect(daysLeftUntil(NOW, NOW)).toBe(0)
    expect(daysLeftUntil(after(-1), NOW)).toBe(0)
  })

  it('counts fourteen days as fourteen, the edge of the first threshold', () => {
    expect(daysLeftUntil(after(14 * 86_400_000), NOW)).toBe(14)
  })
})
