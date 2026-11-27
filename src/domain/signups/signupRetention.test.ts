import { describe, expect, it } from 'vitest'
import { addDays } from '../shared/time'
import {
  SIGNUP_MAX_KEPT_DAYS,
  SIGNUP_REFUSED_KEPT_DAYS,
  signupDueAt,
  signupSweepAction,
  type SweepView,
} from './signupRetention'
import { SIGNUP_STATUSES, type SignupStatus } from './signupRequest'

const T0 = new Date('2026-12-01T10:00:00.000Z')
const HOUR = 60 * 60 * 1000

const view = (over: Partial<SweepView>): SweepView => ({
  status: 'unconfirmed',
  createdAt: T0,
  claimedAt: null,
  decidedAt: null,
  lastConfirmationExpiresAt: null,
  invitationAccepted: false,
  ...over,
})

describe('signupDueAt', () => {
  it('erases an unconfirmed request 24 hours after its LAST confirmation link expired', () => {
    const lastExpiry = new Date(T0.getTime() + 30 * HOUR)
    expect(signupDueAt(view({ lastConfirmationExpiresAt: lastExpiry }))).toEqual(
      new Date(lastExpiry.getTime() + 24 * HOUR),
    )
  })

  it('counts an unconfirmed request with no link held from its creation, as if one had been issued then', () => {
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
  /**
   * The person last submitted the form at T0 (a resend counts as making the request again). Each
   * status gets its own worst case, so a number that one status needs cannot be borrowed by another.
   */
  const lastDecision = new Date(addDays(T0, 30).getTime() - 1)

  const worstCases: Record<SignupStatus, { view: Partial<SweepView>; offset: number }> = {
    // The link lives 24 h from the last submission, and the row is kept 24 h more.
    unconfirmed: {
      view: { lastConfirmationExpiresAt: new Date(T0.getTime() + 24 * HOUR) },
      offset: 48 * HOUR,
    },
    // Decidable until day 30, so it expires there.
    pending: { view: {}, offset: 30 * DAY },
    // Refused at the last instant it could be, kept 30 days.
    refused: { view: { decidedAt: lastDecision }, offset: 60 * DAY - 1 },
    // Approved at the last instant: the invitation's 7 days, then 24 hours.
    approved: { view: { decidedAt: lastDecision }, offset: 30 * DAY - 1 + 7 * DAY + 24 * HOUR },
    // The sweep that expires it erases it.
    expired: { view: { decidedAt: addDays(T0, 30) }, offset: 30 * DAY },
    // Claimed at the last instant: given back an hour later, then expired for good.
    approving: { view: { claimedAt: lastDecision }, offset: 30 * DAY - 1 + HOUR },
  }

  it('is 60', () => {
    expect(SIGNUP_MAX_KEPT_DAYS).toBe(60)
  })

  it.each(SIGNUP_STATUSES)('holds for %s in its own worst case, at the exact instant', (status) => {
    const { view: over, offset } = worstCases[status]
    const due = signupDueAt(view({ status, ...over }))

    expect(due).toEqual(new Date(T0.getTime() + offset))
    expect(offset).toBeLessThanOrEqual(SIGNUP_MAX_KEPT_DAYS * DAY)
  })

  it('reaches 60 days less one millisecond for a refusal at the last instant, and not a millisecond more', () => {
    expect(signupDueAt(view({ status: 'refused', decidedAt: lastDecision }))).toEqual(
      new Date(addDays(T0, 60).getTime() - 1),
    )
  })
})

describe('signupSweepAction', () => {
  it('keeps an unconfirmed request until its date, and erases it from then', () => {
    const due = new Date(T0.getTime() + 48 * HOUR)
    expect(signupSweepAction(view({}), new Date(due.getTime() - 1))).toBe('keep')
    expect(signupSweepAction(view({}), due)).toBe('erase')
  })

  it('keeps an unconfirmed request whose link was renewed past the first 48 hours', () => {
    const renewed = view({ lastConfirmationExpiresAt: new Date(T0.getTime() + 40 * HOUR) })
    expect(signupSweepAction(renewed, new Date(T0.getTime() + 48 * HOUR))).toBe('keep')
    expect(signupSweepAction(renewed, new Date(T0.getTime() + 64 * HOUR))).toBe('erase')
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
