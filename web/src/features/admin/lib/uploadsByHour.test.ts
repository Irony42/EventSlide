import { describe, expect, it, vi } from 'vitest'
import { groupByLocalHour } from './uploadsByHour'
import { uploadPeak } from './uploadPeak'

const quarter = (start: string, count: number) => ({ start, count })

/** India: +5 h 30, a constant offset. */
const INDIA = () => 330
const PARIS_SUMMER = () => 120
const UTC = () => 0

describe('groupByLocalHour', () => {
  it('groups the quarters of one UTC hour into one bar', () => {
    const hours = groupByLocalHour(
      [quarter('2026-06-20T19:00:00.000Z', 2), quarter('2026-06-20T19:45:00.000Z', 3)],
      UTC,
    )

    expect(hours).toEqual([{ start: '2026-06-20T19:00:00.000Z', hour: 19, count: 5 }])
  })

  it('aligns the bars on the reader’s own hour at +5 h 30, not on UTC hours', () => {
    // 18:15 UTC is 23:45 in India, 18:30 UTC is 00:00 the next day: two different local hours,
    // although both sit in the same UTC hour.
    const hours = groupByLocalHour(
      [quarter('2026-06-20T18:15:00.000Z', 4), quarter('2026-06-20T18:30:00.000Z', 6)],
      INDIA,
    )

    expect(hours).toEqual([
      { start: '2026-06-20T17:30:00.000Z', hour: 23, count: 4 },
      { start: '2026-06-20T18:30:00.000Z', hour: 0, count: 6 },
    ])
  })

  it('keeps the bars in time order and leaves empty hours out', () => {
    const hours = groupByLocalHour(
      [quarter('2026-06-20T22:00:00.000Z', 1), quarter('2026-06-20T19:00:00.000Z', 1)],
      PARIS_SUMMER,
    )

    expect(hours.map((hour) => hour.hour)).toEqual([21, 0])
  })

  it('reads the browser’s own zone by default', () => {
    // `getTimezoneOffset` is minus the offset: India, +5 h 30, answers -330.
    const zone = vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-330)
    try {
      const hours = groupByLocalHour([
        quarter('2026-06-20T18:15:00.000Z', 4),
        quarter('2026-06-20T18:30:00.000Z', 6),
      ])

      expect(hours.map((hour) => [hour.hour, hour.count])).toEqual([
        [23, 4],
        [0, 6],
      ])
    } finally {
      zone.mockRestore()
    }
  })

  it('answers nothing for no quarter', () => {
    expect(groupByLocalHour([], UTC)).toEqual([])
  })
})

describe('uploadPeak', () => {
  it('names the busiest hour', () => {
    const peak = uploadPeak([
      { start: 'a', hour: 20, count: 5 },
      { start: 'b', hour: 21, count: 63 },
    ])

    expect(peak).toEqual({ start: 'b', hour: 21, count: 63 })
  })

  it('goes to the earliest hour on a tie', () => {
    const peak = uploadPeak([
      { start: 'a', hour: 20, count: 9 },
      { start: 'b', hour: 21, count: 9 },
    ])

    expect(peak?.hour).toBe(20)
  })

  it('is null when nothing was sent', () => {
    expect(uploadPeak([])).toBeNull()
    expect(uploadPeak([{ start: 'a', hour: 3, count: 0 }])).toBeNull()
  })
})
