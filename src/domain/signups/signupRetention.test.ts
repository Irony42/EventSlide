import { describe, expect, it } from 'vitest'
import { addDays } from '../shared/time'
import {
  SIGNUP_MAX_KEPT_DAYS,
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
  claimedAt: null,
  decidedAt: null,
  invitationAccepted: false,
  ...over,
})

describe('signupDueAt', () => {
  it('erases an unconfirmed request 48 hours after it was made', () => {
    expect(signupDueAt(view({}))).toEqual(new Date(T0.getTime() + 48 * HOUR))
  })

  it('expires a pending request 30 days after it was MADE, whenever it was confirmed', () => {
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

  it('gives a claim one hour', () => {
    expect(signupDueAt(view({ status: 'approving', claimedAt: T0 }))).toEqual(
      new Date(T0.getTime() + HOUR),
    )
  })

  it('has no date for a claim that carries none', () => {
    expect(signupDueAt(view({ status: 'approving' }))).toBeNull()
  })
})

describe('the 60-day bound', () => {
  const DAY = 24 * HOUR
  /** The last instant a request made at T0 can be confirmed: its token's life (24 h). */
  const lastConfirmation = new Date(T0.getTime() + 24 * HOUR)
  /** The last instant a pending request can still be decided: just before it expires. */
  const lastDecision = new Date(addDays(T0, 30).getTime() - 1)

  const dueOffset = (over: Partial<SweepView>): number => {
    const due = signupDueAt(view(over))
    expect(due, `a clock runs on ${over.status}`).not.toBeNull()
    return (due as Date).getTime() - T0.getTime()
  }

  it('is 60', () => {
    expect(SIGNUP_MAX_KEPT_DAYS).toBe(60)
  })

  it.each(SIGNUP_STATUSES.filter((status) => status !== 'approving'))(
    'holds for %s in its worst case: confirmed at the token lifetime, decided at the last instant',
    (status) => {
      const worst: Partial<SweepView> = {
        status,
        decidedAt: lastDecision,
      }
      expect(lastConfirmation.getTime()).toBeLessThan(lastDecision.getTime())
      expect(dueOffset(worst)).toBeLessThanOrEqual(SIGNUP_MAX_KEPT_DAYS * DAY)
    },
  )

  it('reaches 60 days exactly for a refusal at the last instant, which is why pending counts from creation', () => {
    expect(dueOffset({ status: 'refused', decidedAt: lastDecision })).toBeLessThanOrEqual(
      60 * DAY - 1,
    )
  })

  it('holds for an approval after a long pending: invitation expiry (7 days) plus 24 hours later', () => {
    const approved = dueOffset({ status: 'approved', decidedAt: lastDecision })
    expect(approved).toBe(30 * DAY - 1 + 7 * DAY + 24 * HOUR)
    expect(approved).toBeLessThanOrEqual(60 * DAY)
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

  it('keeps a claim for an hour and then gives it back', () => {
    const claimed = view({ status: 'approving', claimedAt: T0 })
    expect(signupSweepAction(claimed, new Date(T0.getTime() + HOUR - 1))).toBe('keep')
    expect(signupSweepAction(claimed, new Date(T0.getTime() + HOUR))).toBe('release')
  })

  it('keeps a claim that carries no date, which is not a claim the sweep can judge', () => {
    expect(signupSweepAction(view({ status: 'approving' }), addDays(T0, 400))).toBe('keep')
  })

  it('erases an expired request', () => {
    expect(signupSweepAction(view({ status: 'expired', decidedAt: T0 }), T0)).toBe('erase')
  })
})
