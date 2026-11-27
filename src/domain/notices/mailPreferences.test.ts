import { describe, expect, it } from 'vitest'
import {
  applyMailPreferencesPatch,
  budgetDayOf,
  DEFAULT_MAIL_PREFERENCES,
  MAIL_COUNTS_KEPT_DAYS,
} from './mailPreferences'

describe('mail preferences', () => {
  it('start with both switches on, so a box with a relay writes as soon as it is updated', () => {
    expect(DEFAULT_MAIL_PREFERENCES).toEqual({ rsvp: true, event: true })
  })

  it('leave a field out of a change as it was', () => {
    const off = { rsvp: false, event: true }
    expect(applyMailPreferencesPatch(off, {})).toEqual(off)
    expect(applyMailPreferencesPatch(off, { event: false })).toEqual({ rsvp: false, event: false })
    expect(applyMailPreferencesPatch(off, { rsvp: true })).toEqual({ rsvp: true, event: true })
  })
})

describe('budgetDayOf', () => {
  it('is the UTC calendar day', () => {
    expect(budgetDayOf(new Date('2026-12-13T23:59:59.999Z'))).toBe('2026-12-13')
    expect(budgetDayOf(new Date('2026-12-14T00:00:00.000Z'))).toBe('2026-12-14')
  })

  it('keeps the daily counts a week', () => {
    expect(MAIL_COUNTS_KEPT_DAYS).toBe(7)
  })
})
