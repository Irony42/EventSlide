import { describe, expect, it } from 'vitest'
import {
  rsvpErasureDate,
  rsvpErasureKey,
  rsvpErasureNotice,
  RSVP_ERASURE_LEVELS,
} from './rsvpErasureNotice'

const NOW = new Date('2026-12-13T12:00:00.000Z')
const inDays = (days: number): Date => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000)
const inHours = (h: number): Date => new Date(NOW.getTime() + h * 60 * 60 * 1000)

describe('rsvpErasureDate', () => {
  const EARLY = new Date('2027-01-01T00:00:00.000Z')
  const LATE = new Date('2027-02-01T00:00:00.000Z')

  it('is the earlier of the replies retention and the purge: the purge takes replies sooner and its hold does not keep them', () => {
    expect(rsvpErasureDate(LATE, EARLY)).toBe(EARLY)
    expect(rsvpErasureDate(EARLY, LATE)).toBe(EARLY)
    expect(rsvpErasureDate(EARLY, EARLY)).toBe(EARLY)
  })

  it('is whichever clock runs when only one does, and none when neither does', () => {
    expect(rsvpErasureDate(EARLY, null)).toBe(EARLY)
    expect(rsvpErasureDate(null, LATE)).toBe(LATE)
    expect(rsvpErasureDate(null, null)).toBeNull()
  })
})

describe('rsvpErasureNotice', () => {
  it('names the two levels, 7 and 1', () => {
    expect([...RSVP_ERASURE_LEVELS]).toEqual([7, 1])
  })

  it('owes nothing with more than 7 days left', () => {
    expect(rsvpErasureNotice(inDays(7.01), NOW, null)).toBeNull()
    expect(rsvpErasureNotice(inDays(30), NOW, null)).toBeNull()
  })

  it('owes the 7-day notice from 7 days down to a little over 1 day', () => {
    expect(rsvpErasureNotice(inDays(7), NOW, null)).toBe(7)
    expect(rsvpErasureNotice(inDays(2), NOW, null)).toBe(7)
    expect(rsvpErasureNotice(inDays(1.01), NOW, null)).toBe(7)
  })

  it('owes the 1-day notice for exactly a day and for less, rounding up: 20 hours is still one day', () => {
    expect(rsvpErasureNotice(inDays(1), NOW, null)).toBe(1)
    expect(rsvpErasureNotice(inHours(20), NOW, null)).toBe(1)
    expect(rsvpErasureNotice(inHours(1), NOW, null)).toBe(1)
  })

  it('owes nothing once the date has arrived: the erasure is the sweep business', () => {
    expect(rsvpErasureNotice(NOW, NOW, null)).toBeNull()
    expect(rsvpErasureNotice(inHours(-1), NOW, null)).toBeNull()
  })

  it('does not repeat a level already noted for this date, nor go back to a less urgent one', () => {
    expect(rsvpErasureNotice(inDays(5), NOW, 7)).toBeNull()
    expect(rsvpErasureNotice(inHours(10), NOW, 1)).toBeNull()
    expect(rsvpErasureNotice(inDays(5), NOW, 1)).toBeNull()
  })

  it('moves on to the 1-day notice once the 7-day one was noted', () => {
    expect(rsvpErasureNotice(inHours(10), NOW, 7)).toBe(1)
  })

  it('gives a date that shows up late the most urgent level, once, not the 7 it has passed', () => {
    expect(rsvpErasureNotice(inHours(10), NOW, null)).toBe(1)
  })
})

describe('rsvpErasureKey', () => {
  it('carries the level and the date, so a date that moves starts the levels over', () => {
    const date = new Date('2027-01-12T00:00:00.000Z')
    expect(rsvpErasureKey(7, date)).toBe('7@2027-01-12T00:00:00.000Z')
    expect(rsvpErasureKey(1, date)).not.toBe(
      rsvpErasureKey(1, new Date('2027-02-12T00:00:00.000Z')),
    )
  })
})
