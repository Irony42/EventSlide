import { describe, expect, it } from 'vitest'
import { formatSendTime } from './formatSendTime'

const NOW = new Date('2026-06-20T21:00:00Z')

describe('formatSendTime', () => {
  it('prints HH:mm in the zone it is given, not in UTC', () => {
    // 19:30 UTC is 21:30 in Paris in June.
    expect(formatSendTime('2026-06-20T19:30:00Z', 'fr', NOW, 'Europe/Paris')).toBe('21:30')
    expect(formatSendTime('2026-06-20T19:30:00Z', 'fr', NOW, 'UTC')).toBe('19:30')
  })

  it('adds the short weekday for a photo that is not from today', () => {
    expect(formatSendTime('2026-06-19T19:30:00Z', 'fr', NOW, 'UTC')).toMatch(/^ven\.? 19:30$/)
    expect(formatSendTime('2026-06-19T19:30:00Z', 'en', NOW, 'UTC')).toBe('Fri 19:30')
  })

  it('decides "today" in the zone, so a late photo is not from yesterday by the UTC date', () => {
    // 23:30 UTC on the 19th is 01:30 on the 20th in Paris, which is today there.
    expect(formatSendTime('2026-06-19T23:30:00Z', 'fr', NOW, 'Europe/Paris')).toBe('01:30')
  })

  it('uses a 24 hour clock in every language', () => {
    expect(formatSendTime('2026-06-20T15:05:00Z', 'en', NOW, 'UTC')).toBe('15:05')
  })

  it('says nothing for a date it cannot read', () => {
    expect(formatSendTime('not a date', 'fr', NOW, 'UTC')).toBeNull()
  })

  it('takes the machine zone when none is given', () => {
    expect(formatSendTime('2026-06-20T19:30:00Z', 'fr', NOW)).toMatch(/^\d{2}:\d{2}$/)
  })
})
