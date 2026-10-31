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

  it('does not ask for photos that are all on the wall, which the notice takes back', () => {
    expect(needsRejectConfirmation(of('published', 'published', 'published', 'published'))).toBe(
      false,
    )
  })

  it.each(['hidden', 'rejected'] as const)(
    'asks for %s photos, which no notice takes back',
    (status) => {
      expect(needsRejectConfirmation(of(status, status, status))).toBe(true)
    },
  )

  it('asks when a single hidden photo hides among published ones, because that batch has no undo', () => {
    expect(needsRejectConfirmation(of('published', 'published', 'hidden'))).toBe(true)
  })
})
