import { describe, expect, it } from 'vitest'
import { DEFAULT_NOTICE_TIME_ZONE, inQuietHours } from './quietHours'

describe('inQuietHours', () => {
  it('is quiet before 08:00 local and from 21:00 local, and awake from 08:00 to 20:59', () => {
    expect(inQuietHours(new Date('2026-12-13T06:59:59.000Z'), 'UTC')).toBe(true)
    expect(inQuietHours(new Date('2026-12-13T07:00:00.000Z'), 'UTC')).toBe(true)
    expect(inQuietHours(new Date('2026-12-13T08:00:00.000Z'), 'UTC')).toBe(false)
    expect(inQuietHours(new Date('2026-12-13T20:59:59.000Z'), 'UTC')).toBe(false)
    expect(inQuietHours(new Date('2026-12-13T21:00:00.000Z'), 'UTC')).toBe(true)
    expect(inQuietHours(new Date('2026-12-13T00:00:00.000Z'), 'UTC')).toBe(true)
  })

  it('reads the hour where the party is, daylight saving included', () => {
    // Paris is UTC+1 in winter and UTC+2 in summer.
    expect(inQuietHours(new Date('2026-12-13T06:59:00.000Z'), 'Europe/Paris')).toBe(true)
    expect(inQuietHours(new Date('2026-12-13T07:00:00.000Z'), 'Europe/Paris')).toBe(false)
    expect(inQuietHours(new Date('2026-07-13T05:59:00.000Z'), 'Europe/Paris')).toBe(true)
    expect(inQuietHours(new Date('2026-07-13T06:00:00.000Z'), 'Europe/Paris')).toBe(false)
    expect(inQuietHours(new Date('2026-07-13T18:59:00.000Z'), 'Europe/Paris')).toBe(false)
    expect(inQuietHours(new Date('2026-07-13T19:00:00.000Z'), 'Europe/Paris')).toBe(true)
  })

  it('has a default zone for an event with no invitation', () => {
    expect(DEFAULT_NOTICE_TIME_ZONE).toBe('Europe/Paris')
  })
})
