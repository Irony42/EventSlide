import { describe, expect, it } from 'vitest'
import { needsRejectConfirmation, REJECT_CONFIRMATION_FROM } from './rejectConfirmation'
import type { PhotoStatus } from '../../../lib/api/dto'

const of = (...statuses: readonly PhotoStatus[]) => statuses.map((status) => ({ status }))

describe('needsRejectConfirmation', () => {
  it('asks from three photos, once one of them was still waiting', () => {
    expect(REJECT_CONFIRMATION_FROM).toBe(3)
    expect(needsRejectConfirmation(of('pending', 'pending', 'pending'))).toBe(true)
  })

  it('does not ask for a pair, which is a deliberate pick', () => {
    expect(needsRejectConfirmation(of('pending', 'pending'))).toBe(false)
  })

  it('asks when a single waiting photo hides among published ones, because that batch has no undo', () => {
    expect(needsRejectConfirmation(of('published', 'published', 'pending'))).toBe(true)
  })

  it.each(['published', 'hidden', 'rejected'] as const)(
    'does not ask for %s photos, which the notice takes back',
    (status) => {
      expect(needsRejectConfirmation(of(status, status, status, status))).toBe(false)
    },
  )
})
