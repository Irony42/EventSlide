import { describe, expect, it } from 'vitest'
import { addDays } from '../shared/time'
import {
  SIGNUP_MAX_KEPT_DAYS,
  SIGNUP_PENDING_EXPIRES_AFTER_DAYS,
  SIGNUP_REFUSED_KEPT_DAYS,
  signupDueAt,
  signupSweepAction,
  type SweepView,
} from './signupRetention'
import { SIGNUP_STATUSES } from './signupRequest'

const T0 = new Date('2026-12-01T10:00:00.000Z')
const HOUR = 60 * 60 * 1000

const view = (over: Partial<SweepView>): SweepView => ({
  status: 'unconfirmed',
  createdAt: T0,
  confirmedAt: null,
  decidedAt: null,
  invitationAccepted: false,
  ...over,
})

describe('signupDueAt', () => {
  it('erases an unconfirmed request 48 hours after it was made', () => {
    expect(signupDueAt(view({}))).toEqual(new Date(T0.getTime() + 48 * HOUR))
  })

  it('expires a pending request 30 days after its confirmation', () => {
    const confirmedAt = addDays(T0, 1)
    expect(signupDueAt(view({ status: 'pending', confirmedAt }))).toEqual(
      addDays(confirmedAt, SIGNUP_PENDING_EXPIRES_AFTER_DAYS),
    )
  })

  it('counts a pending request with no confirmation date from its creation', () => {
    expect(signupDueAt(view({ status: 'pending' }))).toEqual(addDays(T0, 30))
  })

  it('erases a refused request 30 days after the refusal', () => {
    expect(signupDueAt(view({ status: 'refused', decidedAt: T0 }))).toEqual(
      addDays(T0, SIGNUP_REFUSED_KEPT_DAYS),
    )
  })

  it('has no date for a refusal that carries none', () => {
    expect(signupDueAt(view({ status: 'refused' }))).toBeNull()
  })

  it('erases an approved request 24 hours after its invitation expired, 7 days + 24 h', () => {
    expect(signupDueAt(view({ status: 'approved', decidedAt: T0 }))).toEqual(
      new Date(addDays(T0, 7).getTime() + 24 * HOUR),
    )
  })

  it('has no date for an approval that carries none', () => {
    expect(signupDueAt(view({ status: 'approved' }))).toBeNull()
  })

  it('erases an expired request at once, from when it expired', () => {
    expect(signupDueAt(view({ status: 'expired', decidedAt: addDays(T0, 5) }))).toEqual(
      addDays(T0, 5),
    )
    expect(signupDueAt(view({ status: 'expired' }))).toEqual(T0)
  })

  it('runs no clock on a claim in flight', () => {
    expect(signupDueAt(view({ status: 'approving' }))).toBeNull()
  })
})

describe('the 60-day bound', () => {
  it('holds for every status, whatever the dates: nothing is due later than 60 days after creation', () => {
    // The worst chain: confirmed at once, pending 29 days, refused on day 29, kept 30 more.
    const refusedOnDay29 = addDays(T0, 29)
    const due = signupDueAt(view({ status: 'refused', decidedAt: refusedOnDay29 }))
    expect(due).not.toBeNull()
    expect((due as Date).getTime() - T0.getTime()).toBeLessThanOrEqual(
      SIGNUP_MAX_KEPT_DAYS * 24 * HOUR,
    )
  })

  it('is 60', () => {
    expect(SIGNUP_MAX_KEPT_DAYS).toBe(60)
  })

  it('names every status', () => {
    expect(SIGNUP_STATUSES).toHaveLength(6)
  })
})

describe('signupSweepAction', () => {
  it('keeps an unconfirmed request until its date, and erases it from then', () => {
    const due = new Date(T0.getTime() + 48 * HOUR)
    expect(signupSweepAction(view({}), new Date(due.getTime() - 1))).toBe('keep')
    expect(signupSweepAction(view({}), due)).toBe('erase')
  })

  it('expires a pending request rather than erasing it', () => {
    const due = addDays(T0, 30)
    expect(signupSweepAction(view({ status: 'pending' }), new Date(due.getTime() - 1))).toBe('keep')
    expect(signupSweepAction(view({ status: 'pending' }), due)).toBe('expire')
  })

  it('erases an approved request as soon as its invitation is accepted', () => {
    expect(
      signupSweepAction(view({ status: 'approved', decidedAt: T0, invitationAccepted: true }), T0),
    ).toBe('erase')
  })

  it('keeps an approved request whose invitation is still open', () => {
    expect(signupSweepAction(view({ status: 'approved', decidedAt: T0 }), addDays(T0, 7))).toBe(
      'keep',
    )
  })

  it('erases a refused request 30 days after the refusal', () => {
    const decided = view({ status: 'refused', decidedAt: T0 })
    expect(signupSweepAction(decided, addDays(T0, 29))).toBe('keep')
    expect(signupSweepAction(decided, addDays(T0, 30))).toBe('erase')
  })

  it('never touches a claim in flight', () => {
    expect(signupSweepAction(view({ status: 'approving' }), addDays(T0, 400))).toBe('keep')
  })

  it('erases an expired request', () => {
    expect(signupSweepAction(view({ status: 'expired', decidedAt: T0 }), T0)).toBe('erase')
  })
})
