import { describe, expect, it } from 'vitest'
import {
  FAR_AWAY_MS,
  leadMinutes,
  parseTimeOfDay,
  resolveAnnouncementInstant,
} from './announcementInstant'

/** A local date and time: the rule is read in the browser's zone, so the tests are written in it. */
const local = (month: number, day: number, hours: number, minutes = 0, seconds = 0): number =>
  new Date(2026, month - 1, day, hours, minutes, seconds).getTime()

describe('resolveAnnouncementInstant', () => {
  it('takes the same day while the time is still ahead', () => {
    const resolved = resolveAnnouncementInstant('22:00', local(6, 20, 20, 48), null)

    expect(resolved).toEqual({
      atMs: local(6, 20, 22, 0),
      day: 'today',
      leadMs: 72 * 60_000,
      far: false,
    })
  })

  it('takes tomorrow when the time has gone by, and says so', () => {
    const resolved = resolveAnnouncementInstant('00:30', local(6, 20, 1, 0), null)

    expect(resolved?.atMs).toBe(local(6, 21, 0, 30))
    expect(resolved?.day).toBe('tomorrow')
    expect(resolved?.leadMs).toBe(23.5 * 3_600_000)
  })

  it('crosses midnight: 00:30 typed at 23:00 is the half past midnight to come', () => {
    const resolved = resolveAnnouncementInstant('00:30', local(6, 20, 23, 0), null)

    expect(resolved?.atMs).toBe(local(6, 21, 0, 30))
    expect(resolved?.day).toBe('tomorrow')
    expect(resolved?.leadMs).toBe(90 * 60_000)
  })

  it('keeps a time typed a few seconds late as today, as far as the server allows (a minute)', () => {
    // 22:00 typed at 22:00:30: the server accepts an instant up to sixty seconds in the past.
    const late = resolveAnnouncementInstant('22:00', local(6, 20, 22, 0, 30), null)
    expect(late?.day).toBe('today')
    expect(late?.leadMs).toBe(-30_000)

    // At 22:01:00 the minute is spent: the next 22:00 is tomorrow's.
    const gone = resolveAnnouncementInstant('22:00', local(6, 20, 22, 1, 0), null)
    expect(gone?.day).toBe('tomorrow')
  })

  it('starts from a scheduled opening in the future: 00:30 is the night after the doors open', () => {
    // A party opening on the 25th at 18:00, typed on the 20th at 10:00.
    const opens = local(6, 25, 18, 0)
    const resolved = resolveAnnouncementInstant('00:30', local(6, 20, 10, 0), opens)

    expect(resolved?.atMs).toBe(local(6, 26, 0, 30))
    expect(resolved?.day).toBe('later')
  })

  it('takes a time later than the opening on the opening’s own day, and the opening’s own minute', () => {
    const opens = local(6, 25, 18, 0)
    const now = local(6, 20, 10, 0)

    expect(resolveAnnouncementInstant('19:00', now, opens)?.atMs).toBe(local(6, 25, 19, 0))
    expect(resolveAnnouncementInstant('18:00', now, opens)?.atMs).toBe(local(6, 25, 18, 0))
  })

  it('ignores an opening that is already behind: the evening is on', () => {
    const resolved = resolveAnnouncementInstant('00:30', local(6, 20, 21, 0), local(6, 20, 18, 0))

    expect(resolved?.atMs).toBe(local(6, 21, 0, 30))
    expect(resolved?.day).toBe('tomorrow')
  })

  it('warns beyond twelve hours, and not at twelve', () => {
    const now = local(6, 20, 21, 0)

    expect(resolveAnnouncementInstant('09:00', now, null)?.leadMs).toBe(FAR_AWAY_MS)
    expect(resolveAnnouncementInstant('09:00', now, null)?.far).toBe(false)
    expect(resolveAnnouncementInstant('09:01', now, null)?.far).toBe(true)
  })

  it('says nothing for a field that is not a time of day', () => {
    const now = local(6, 20, 21, 0)

    for (const typed of ['', '24:00', '9:5', '12:60', 'abc', '22:00:00']) {
      expect(resolveAnnouncementInstant(typed, now, null), typed).toBeNull()
    }
  })
})

describe('parseTimeOfDay', () => {
  it('reads the value of a time field', () => {
    expect(parseTimeOfDay('07:05')).toEqual({ hours: 7, minutes: 5 })
    expect(parseTimeOfDay('23:59')).toEqual({ hours: 23, minutes: 59 })
  })
})

describe('leadMinutes', () => {
  it('rounds to the nearest minute and never goes below zero', () => {
    expect(leadMinutes(72 * 60_000)).toBe(72)
    expect(leadMinutes(89_000)).toBe(1)
    expect(leadMinutes(-30_000)).toBe(0)
  })
})
