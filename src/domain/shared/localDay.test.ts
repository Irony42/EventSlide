import { describe, expect, it } from 'vitest'
import { isCalendarDay, localDayOf, startOfLocalDay, startOfNextLocalDay } from './localDay'

describe('isCalendarDay', () => {
  it('accepts a real day and refuses what is not one', () => {
    expect(isCalendarDay('2026-12-13')).toBe(true)
    expect(isCalendarDay('2028-02-29')).toBe(true)
    expect(isCalendarDay('2026-02-29')).toBe(false)
    expect(isCalendarDay('2026-02-31')).toBe(false)
    expect(isCalendarDay('2026-13-01')).toBe(false)
    expect(isCalendarDay('2026-12-00')).toBe(false)
    expect(isCalendarDay('0000-01-01')).toBe(false)
    expect(isCalendarDay('2026-1-1')).toBe(false)
    expect(isCalendarDay('2026-12-13T10:00')).toBe(false)
    expect(isCalendarDay(20261213)).toBe(false)
    expect(isCalendarDay(null)).toBe(false)
  })
})

describe('localDayOf', () => {
  it('reads the day where the party is, not in UTC', () => {
    const lateEvening = new Date('2026-12-13T23:30:00Z')

    expect(localDayOf(lateEvening, 'UTC')).toBe('2026-12-13')
    expect(localDayOf(lateEvening, 'Europe/Paris')).toBe('2026-12-14')
    expect(localDayOf(lateEvening, 'America/New_York')).toBe('2026-12-13')
  })

  it('reads midnight as the start of a day, never as hour 24', () => {
    expect(localDayOf(new Date('2026-12-13T23:00:00Z'), 'Europe/Paris')).toBe('2026-12-14')
  })
})

describe('startOfLocalDay', () => {
  it('is local midnight, whatever the offset', () => {
    expect(startOfLocalDay('2026-12-14', 'UTC').toISOString()).toBe('2026-12-14T00:00:00.000Z')
    expect(startOfLocalDay('2026-12-14', 'Europe/Paris').toISOString()).toBe(
      '2026-12-13T23:00:00.000Z',
    )
    expect(startOfLocalDay('2026-12-14', 'America/New_York').toISOString()).toBe(
      '2026-12-14T05:00:00.000Z',
    )
  })

  it('follows the summer clock', () => {
    expect(startOfLocalDay('2026-07-14', 'Europe/Paris').toISOString()).toBe(
      '2026-07-13T22:00:00.000Z',
    )
  })

  it('finds midnight on the day the clocks change, both ways', () => {
    // Spring forward at 02:00 on 29 March 2026: midnight is still winter time.
    expect(startOfLocalDay('2026-03-29', 'Europe/Paris').toISOString()).toBe(
      '2026-03-28T23:00:00.000Z',
    )
    // Midnight after the change is summer time: the day is 23 hours long.
    expect(startOfLocalDay('2026-03-30', 'Europe/Paris').toISOString()).toBe(
      '2026-03-29T22:00:00.000Z',
    )
    // Fall back at 03:00 on 25 October 2026: midnight is still summer time.
    expect(startOfLocalDay('2026-10-25', 'Europe/Paris').toISOString()).toBe(
      '2026-10-24T22:00:00.000Z',
    )
    expect(startOfLocalDay('2026-10-26', 'Europe/Paris').toISOString()).toBe(
      '2026-10-25T23:00:00.000Z',
    )
  })
})

describe('startOfNextLocalDay', () => {
  it('is when the day after begins, so the whole deadline day counts', () => {
    expect(startOfNextLocalDay('2026-12-13', 'Europe/Paris').toISOString()).toBe(
      '2026-12-13T23:00:00.000Z',
    )
  })

  it('rolls over a month and a year', () => {
    expect(startOfNextLocalDay('2026-12-31', 'UTC').toISOString()).toBe('2027-01-01T00:00:00.000Z')
    expect(startOfNextLocalDay('2028-02-28', 'UTC').toISOString()).toBe('2028-02-29T00:00:00.000Z')
  })

  it('lasts the 25 hours of the day the clocks go back', () => {
    // 25 October is 25 hours long in Paris: the day after begins at 23:00 UTC.
    expect(startOfNextLocalDay('2026-10-25', 'Europe/Paris').toISOString()).toBe(
      '2026-10-25T23:00:00.000Z',
    )
  })
})
