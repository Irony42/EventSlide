import { describe, expect, it } from 'vitest'
import { isRsvpExpired, rsvpCutoffs, rsvpExpiryOf } from './rsvpExpiry'

const CLOSED = new Date('2026-12-14T10:00:00Z')
const STARTS = new Date('2026-12-13T18:00:00Z')

describe('rsvpExpiryOf', () => {
  it('is 30 days after the event closed', () => {
    expect(rsvpExpiryOf({ closedAt: CLOSED, startsAt: null })?.toISOString()).toBe(
      '2027-01-13T10:00:00.000Z',
    )
  })

  it('is 60 days after the start of the invitation when the event never closed', () => {
    expect(rsvpExpiryOf({ closedAt: null, startsAt: STARTS })?.toISOString()).toBe(
      '2027-02-11T18:00:00.000Z',
    )
  })

  it('is the earlier of the two', () => {
    expect(rsvpExpiryOf({ closedAt: CLOSED, startsAt: STARTS })?.toISOString()).toBe(
      '2027-01-13T10:00:00.000Z',
    )
    // Closed very late: the start's 60 days come first.
    const lateClose = new Date('2027-03-01T10:00:00Z')
    expect(rsvpExpiryOf({ closedAt: lateClose, startsAt: STARTS })?.toISOString()).toBe(
      '2027-02-11T18:00:00.000Z',
    )
  })

  it('is the same instant when the two dates agree, and none when no clock runs', () => {
    const closed = new Date('2027-01-12T18:00:00Z')
    expect(rsvpExpiryOf({ closedAt: closed, startsAt: STARTS })?.toISOString()).toBe(
      '2027-02-11T18:00:00.000Z',
    )
    expect(rsvpExpiryOf({ closedAt: null, startsAt: null })).toBeNull()
  })
})

describe('isRsvpExpired', () => {
  const dates = { closedAt: CLOSED, startsAt: STARTS }

  it('keeps a reply on day 29 and erases it on day 30 after the close', () => {
    expect(isRsvpExpired(dates, new Date('2027-01-12T10:00:00Z'))).toBe(false)
    expect(isRsvpExpired(dates, new Date('2027-01-13T09:59:59Z'))).toBe(false)
    expect(isRsvpExpired(dates, new Date('2027-01-13T10:00:00Z'))).toBe(true)
    expect(isRsvpExpired(dates, new Date('2027-01-14T10:00:00Z'))).toBe(true)
  })

  it('erases an event that never closed 60 days after its start', () => {
    const open = { closedAt: null, startsAt: STARTS }

    expect(isRsvpExpired(open, new Date('2027-02-10T18:00:00Z'))).toBe(false)
    expect(isRsvpExpired(open, new Date('2027-02-11T18:00:00Z'))).toBe(true)
  })

  it('never erases when no date is known', () => {
    expect(
      isRsvpExpired({ closedAt: null, startsAt: null }, new Date('2100-01-01T00:00:00Z')),
    ).toBe(false)
  })
})

describe('rsvpCutoffs', () => {
  it('turns the rule into two instants a query compares with, agreeing with isRsvpExpired', () => {
    const now = new Date('2027-01-13T10:00:00Z')
    const { closedBy, startedBy } = rsvpCutoffs(now)

    expect(closedBy.toISOString()).toBe('2026-12-14T10:00:00.000Z')
    expect(startedBy.toISOString()).toBe('2026-11-14T10:00:00.000Z')
    expect(isRsvpExpired({ closedAt: closedBy, startsAt: null }, now)).toBe(true)
    expect(isRsvpExpired({ closedAt: new Date(closedBy.getTime() + 1), startsAt: null }, now)).toBe(
      false,
    )
    expect(isRsvpExpired({ closedAt: null, startsAt: startedBy }, now)).toBe(true)
    expect(
      isRsvpExpired({ closedAt: null, startsAt: new Date(startedBy.getTime() + 1) }, now),
    ).toBe(false)
  })
})
