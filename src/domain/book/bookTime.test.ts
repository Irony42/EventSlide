import { describe, expect, it } from 'vitest'
import {
  dayMomentOf,
  formatClock,
  formatLongDate,
  localParts,
  normalizeTimeZone,
  partyDayOf,
} from './bookTime'

describe('normalizeTimeZone', () => {
  it('keeps a valid zone in its canonical form', () => {
    expect(normalizeTimeZone('Europe/Paris')).toBe('Europe/Paris')
    expect(normalizeTimeZone('America/New_York')).toBe('America/New_York')
  })
  it('accepts UTC, which Intl.supportedValuesOf would refuse', () => {
    expect(normalizeTimeZone('UTC')).toBe('UTC')
    expect(normalizeTimeZone('utc')).toBe('UTC')
  })
  it('falls back to Paris on anything unreadable', () => {
    for (const bad of [undefined, null, 42, '', 'x'.repeat(65), 'Not/AZone', '../etc']) {
      expect(normalizeTimeZone(bad)).toBe('Europe/Paris')
    }
  })
})

describe('localParts', () => {
  it('reads the wall clock of the zone, not of the machine', () => {
    const ms = Date.UTC(2026, 5, 13, 18, 5)
    expect(localParts(ms, 'Europe/Paris')).toMatchObject({ hour: 20, minute: 5, weekday: 6 })
    expect(localParts(ms, 'UTC')).toMatchObject({ hour: 18, minute: 5, weekday: 6 })
    expect(localParts(ms, 'Asia/Tokyo')).toMatchObject({ hour: 3, minute: 5, weekday: 0 })
  })
  it('follows the change of hour: 2026-03-29 02:00 Paris does not exist', () => {
    expect(localParts(Date.UTC(2026, 2, 29, 0, 59), 'Europe/Paris').hour).toBe(1)
    expect(localParts(Date.UTC(2026, 2, 29, 1, 0), 'Europe/Paris').hour).toBe(3)
  })
  it('reads midnight as 0, never 24', () => {
    expect(localParts(Date.UTC(2026, 5, 13, 22, 0), 'Europe/Paris').hour).toBe(0)
  })
})

describe('party day', () => {
  it('belongs a 1 a.m. photograph to the evening before, and 5 a.m. exactly to the new day', () => {
    const night = localParts(Date.UTC(2026, 5, 13, 23, 30), 'Europe/Paris') // Sunday 01:30
    const dawn = localParts(Date.UTC(2026, 5, 14, 3, 0), 'Europe/Paris') // Sunday 05:00
    const saturday = localParts(Date.UTC(2026, 5, 13, 18, 0), 'Europe/Paris')
    expect(partyDayOf(night)).toEqual({ dayNumber: partyDayOf(saturday).dayNumber, weekday: 6 })
    expect(partyDayOf(dawn).weekday).toBe(0)
    expect(partyDayOf(dawn).dayNumber).toBe(partyDayOf(saturday).dayNumber + 1)
  })
})

describe('dayMomentOf', () => {
  it('cuts at 5, 12, 18 and 23', () => {
    const table: [number, string][] = [
      [4, 'night'],
      [5, 'morning'],
      [11, 'morning'],
      [12, 'afternoon'],
      [17, 'afternoon'],
      [18, 'evening'],
      [22, 'evening'],
      [23, 'night'],
      [0, 'night'],
    ]
    for (const [hour, moment] of table) expect(dayMomentOf(hour)).toBe(moment)
  })
})

describe('formatClock', () => {
  it('writes the hour the way each language does', () => {
    expect(formatClock(19, 5, 'fr')).toBe('19 h 05')
    expect(formatClock(19, 5, 'de')).toBe('19:05')
    expect(formatClock(19, 5, 'es')).toBe('19:05')
    expect(formatClock(19, 5, 'it')).toBe('19:05')
    expect(formatClock(19, 5, 'en')).toBe('7:05 PM')
    expect(formatClock(0, 0, 'en')).toBe('12:00 AM')
    expect(formatClock(12, 30, 'en')).toBe('12:30 PM')
  })
})

describe('formatLongDate', () => {
  it('writes the date of the zone in the language of the book', () => {
    const ms = Date.UTC(2026, 5, 14, 22, 30) // already the 15th in Paris
    expect(formatLongDate(ms, 'Europe/Paris', 'fr')).toBe('15 juin 2026')
    expect(formatLongDate(ms, 'America/New_York', 'en')).toBe('June 14, 2026')
  })
})
