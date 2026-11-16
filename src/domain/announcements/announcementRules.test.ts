import { describe, expect, it } from 'vitest'
import {
  ANNOUNCEMENT_DURATION_SECONDS,
  hasRoomForAnnouncement,
  isAnnouncementInstant,
  MAX_ANNOUNCEMENTS_PER_EVENT,
  parseAnnouncementCountdown,
  parseAnnouncementDuration,
  parseAnnouncementInstant,
  parseAnnouncementKind,
} from './announcementRules'

const NOW = new Date('2026-06-20T21:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

describe('parseAnnouncementKind', () => {
  it('takes an absent kind as fullscreen', () => {
    const result = parseAnnouncementKind(undefined)

    expect(result.ok && result.value).toBe('fullscreen')
  })

  it('accepts the two kinds', () => {
    expect(parseAnnouncementKind('fullscreen').ok).toBe(true)
    expect(parseAnnouncementKind('discreet').ok).toBe(true)
  })

  it('refuses any other value', () => {
    for (const raw of ['banner', '', null, 3, 'Fullscreen']) {
      const result = parseAnnouncementKind(raw)
      expect(!result.ok && result.error.code).toBe('announcement.kindInvalid')
    }
  })
})

describe('parseAnnouncementDuration', () => {
  it('accepts a fullscreen card from 10 to 120 seconds', () => {
    expect(parseAnnouncementDuration('fullscreen', 10).ok).toBe(true)
    expect(parseAnnouncementDuration('fullscreen', 120).ok).toBe(true)
  })

  it('refuses 9 and 121 seconds for a fullscreen card, and says the bounds of its kind', () => {
    for (const raw of [9, 121]) {
      const result = parseAnnouncementDuration('fullscreen', raw)
      expect(!result.ok && result.error.code).toBe('announcement.durationInvalid')
      expect(!result.ok && result.error.details).toEqual({ kind: 'fullscreen', min: 10, max: 120 })
    }
  })

  it('refuses a discreet length for a fullscreen card: 300 seconds', () => {
    expect(parseAnnouncementDuration('fullscreen', 300).ok).toBe(false)
  })

  it('accepts a discreet announcement from 5 to 30 minutes', () => {
    expect(parseAnnouncementDuration('discreet', 300).ok).toBe(true)
    expect(parseAnnouncementDuration('discreet', 1800).ok).toBe(true)
  })

  it('refuses 299 and 1801 seconds for a discreet one, and a fullscreen length (60)', () => {
    for (const raw of [299, 1801, 60]) {
      const result = parseAnnouncementDuration('discreet', raw)
      expect(!result.ok && result.error.code).toBe('announcement.durationInvalid')
      expect(!result.ok && result.error.details).toEqual({ kind: 'discreet', min: 300, max: 1800 })
    }
  })

  it('never rounds or clamps: a fraction, a string and null are refused', () => {
    for (const raw of [30.5, '30', null, undefined, Number.NaN]) {
      expect(parseAnnouncementDuration('fullscreen', raw).ok).toBe(false)
    }
  })

  it('has the defaults the interface offers', () => {
    expect(ANNOUNCEMENT_DURATION_SECONDS.fullscreen.default).toBe(30)
    expect(ANNOUNCEMENT_DURATION_SECONDS.discreet.default).toBe(900)
  })
})

describe('parseAnnouncementCountdown', () => {
  it('accepts none, 1, 5, 10 and 15 minutes for a fullscreen card', () => {
    for (const seconds of [0, 60, 300, 600, 900]) {
      expect(parseAnnouncementCountdown('fullscreen', seconds).ok).toBe(true)
    }
  })

  it('refuses a countdown that is not in the list', () => {
    for (const raw of [1, 59, 120, 901, -60, '300', null]) {
      const result = parseAnnouncementCountdown('fullscreen', raw)
      expect(!result.ok && result.error.code).toBe('announcement.countdownInvalid')
    }
  })

  it('accepts only zero for a discreet announcement', () => {
    expect(parseAnnouncementCountdown('discreet', 0).ok).toBe(true)
    for (const seconds of [60, 300, 900]) {
      const result = parseAnnouncementCountdown('discreet', seconds)
      expect(!result.ok && result.error.code).toBe('announcement.countdownInvalid')
      expect(!result.ok && result.error.details).toEqual({ kind: 'discreet', allowed: '0' })
    }
  })
})

describe('isAnnouncementInstant', () => {
  it('accepts 60 seconds in the past and refuses 61', () => {
    expect(isAnnouncementInstant(new Date(NOW.getTime() - 60_000), NOW)).toBe(true)
    expect(isAnnouncementInstant(new Date(NOW.getTime() - 61_000), NOW)).toBe(false)
  })

  it('accepts 60 days ahead and refuses a millisecond more', () => {
    expect(isAnnouncementInstant(new Date(NOW.getTime() + 60 * DAY), NOW)).toBe(true)
    expect(isAnnouncementInstant(new Date(NOW.getTime() + 60 * DAY + 1), NOW)).toBe(false)
  })

  it('accepts now', () => {
    expect(isAnnouncementInstant(NOW, NOW)).toBe(true)
  })

  it('refuses a date that is not a date', () => {
    expect(isAnnouncementInstant(new Date('nonsense'), NOW)).toBe(false)
  })
})

describe('parseAnnouncementInstant', () => {
  it('reads an ISO 8601 string', () => {
    const result = parseAnnouncementInstant('2026-06-20T22:00:00.000Z', NOW)

    expect(result.ok && result.value.toISOString()).toBe('2026-06-20T22:00:00.000Z')
  })

  it('refuses a string that is not a date, and what is not a string', () => {
    for (const raw of ['soon', '', 1782000000000, null]) {
      const result = parseAnnouncementInstant(raw, NOW)
      expect(!result.ok && result.error.code).toBe('announcement.atInvalid')
    }
  })

  it('refuses a moment out of the bounds and says them', () => {
    const result = parseAnnouncementInstant('2026-06-20T20:58:00.000Z', NOW)

    expect(!result.ok && result.error.code).toBe('announcement.atInvalid')
    expect(!result.ok && result.error.details).toEqual({ pastToleranceSeconds: 60, maxDays: 60 })
  })
})

describe('hasRoomForAnnouncement', () => {
  it('lets the fiftieth in and refuses the fifty-first', () => {
    expect(
      hasRoomForAnnouncement(MAX_ANNOUNCEMENTS_PER_EVENT - 1, MAX_ANNOUNCEMENTS_PER_EVENT),
    ).toBe(true)
    expect(hasRoomForAnnouncement(MAX_ANNOUNCEMENTS_PER_EVENT, MAX_ANNOUNCEMENTS_PER_EVENT)).toBe(
      false,
    )
  })
})
