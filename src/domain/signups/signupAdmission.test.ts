import { describe, expect, it } from 'vitest'
import { addDays } from '../shared/time'
import {
  SIGNUP_MAX_PER_ADDRESS_PER_DAY,
  SIGNUP_REFUSED_SILENCE_DAYS,
  SIGNUP_RESEND_AFTER_MS,
  decideSignupAdmission,
  type AddressRequestView,
} from './signupAdmission'

const NOW = new Date('2026-12-01T12:00:00.000Z')

const view = (over: Partial<AddressRequestView>): AddressRequestView => ({
  status: 'unconfirmed',
  decidedAt: null,
  lastConfirmationAt: NOW,
  ...over,
})

const decide = (requests: readonly AddressRequestView[], confirmationsInLastDay = 0) =>
  decideSignupAdmission({ now: NOW, requests, confirmationsInLastDay })

describe('decideSignupAdmission', () => {
  it('creates a request for an address the box holds nothing about', () => {
    expect(decide([])).toBe('create')
  })

  it.each(['pending', 'approving'] as const)('stays silent while a request is %s', (status) => {
    expect(decide([view({ status })])).toBe('silent')
  })

  it('creates again for an approved request, whose account may be a moderator asking for a space', () => {
    expect(decide([view({ status: 'approved' })])).toBe('create')
  })

  it('creates again for an expired one', () => {
    expect(decide([view({ status: 'expired' })])).toBe('create')
  })

  describe('after a refusal', () => {
    it('stays silent for 30 days', () => {
      const decidedAt = addDays(NOW, -(SIGNUP_REFUSED_SILENCE_DAYS - 1))
      expect(decide([view({ status: 'refused', decidedAt })])).toBe('silent')
    })

    it('speaks again on the thirtieth day exactly', () => {
      const decidedAt = addDays(NOW, -SIGNUP_REFUSED_SILENCE_DAYS)
      expect(decide([view({ status: 'refused', decidedAt })])).toBe('create')
    })

    it('treats a refusal with no date as old', () => {
      expect(decide([view({ status: 'refused', decidedAt: null })])).toBe('create')
    })
  })

  describe('the per-address daily cap', () => {
    it('lets the third mail through', () => {
      expect(decide([], SIGNUP_MAX_PER_ADDRESS_PER_DAY - 1)).toBe('create')
    })

    it('refuses the fourth, whatever the requests say', () => {
      expect(decide([], SIGNUP_MAX_PER_ADDRESS_PER_DAY)).toBe('silent')
      expect(
        decide(
          [view({ lastConfirmationAt: new Date(NOW.getTime() - 2 * SIGNUP_RESEND_AFTER_MS) })],
          SIGNUP_MAX_PER_ADDRESS_PER_DAY,
        ),
      ).toBe('silent')
    })

    it('is 3', () => {
      expect(SIGNUP_MAX_PER_ADDRESS_PER_DAY).toBe(3)
    })
  })

  describe('an unconfirmed request', () => {
    it('is not resent to within the hour', () => {
      const lastConfirmationAt = new Date(NOW.getTime() - SIGNUP_RESEND_AFTER_MS + 1)
      expect(decide([view({ lastConfirmationAt })])).toBe('silent')
    })

    it('is not resent to at exactly an hour', () => {
      const lastConfirmationAt = new Date(NOW.getTime() - SIGNUP_RESEND_AFTER_MS)
      expect(decide([view({ lastConfirmationAt })])).toBe('silent')
    })

    it('is resent to after more than an hour', () => {
      const lastConfirmationAt = new Date(NOW.getTime() - SIGNUP_RESEND_AFTER_MS - 1)
      expect(decide([view({ lastConfirmationAt })])).toBe('resend')
    })
  })
})
