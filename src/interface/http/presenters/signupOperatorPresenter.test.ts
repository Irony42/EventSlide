import { describe, expect, it } from 'vitest'
import { createSignupRequest, SIGNUP_STATUSES } from '../../../domain/signups/signupRequest'
import { EmailAddress } from '../../../domain/users/emailAddress'
import { listedStatus, toSiteSignupPageDto } from './signupOperatorPresenter'

const AT = new Date('2026-11-27T10:00:00Z')

const aRequest = () => {
  const email = EmailAddress.create('camille@example.test')
  if (!email.ok) throw new Error('fixture rejected')
  const created = createSignupRequest(
    { id: 'signup-1', email: email.value, clientName: 'Mariage de Léa', locale: 'fr' },
    AT,
  )
  if (!created.ok) throw new Error('fixture rejected')
  return created.value
}

describe('the operator list presenter', () => {
  it.each([
    ['pending', 'pending'],
    ['approving', 'pending'],
    ['approved', 'approved'],
    ['refused', 'refused'],
  ] as const)('shows a %s request as %s', (status, shown) => {
    expect(listedStatus(status)).toBe(shown)
  })

  it.each(['unconfirmed', 'expired'] as const)(
    'refuses to name a %s request: the list never asks for one',
    (status) => {
      expect(() => listedStatus(status)).toThrow(status)
    },
  )

  it('names every status the domain has, so a new one cannot be forgotten', () => {
    const named = SIGNUP_STATUSES.filter((status) => {
      try {
        listedStatus(status)
        return true
      } catch {
        return false
      }
    })

    expect(named).toEqual(['pending', 'approving', 'approved', 'refused'])
  })

  it('carries the fields of a request into its page', () => {
    const page = toSiteSignupPageDto({
      items: [{ request: { ...aRequest(), status: 'approving' }, existingAccount: true }],
      pendingCount: 1,
      next: null,
    })

    expect(page.items).toEqual([
      expect.objectContaining({
        id: 'signup-1',
        email: 'camille@example.test',
        clientName: 'Mariage de Léa',
        status: 'pending',
        existingAccount: true,
        confirmedAt: null,
      }),
    ])
    expect(page.pendingCount).toBe(1)
    expect(page.next).toBeNull()
  })
})
