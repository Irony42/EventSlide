import { describe, expect, it } from 'vitest'
import { canTransition, isPhotoStatus, PHOTO_STATUSES } from '../photos/photoStatus'
import {
  allowedDecisionsFrom,
  inverseOf,
  MODERATION_DECISIONS,
  targetStatusFor,
} from './moderationDecision'

describe('targetStatusFor', () => {
  it.each([
    ['publish', 'published'],
    ['reject', 'rejected'],
    ['hide', 'hidden'],
  ] as const)('sends %s to the %s status', (decision, status) => {
    expect(targetStatusFor(decision)).toBe(status)
  })

  it.each(MODERATION_DECISIONS)(
    'maps %s onto a status the photo state machine recognises',
    (decision) => {
      expect(isPhotoStatus(targetStatusFor(decision))).toBe(true)
    },
  )
})

describe('inverseOf', () => {
  it('undoes hide by putting the photo back on the wall', () => {
    expect(inverseOf('hide')).toBe('publish')
  })

  it('undoes hide with a decision the status machine allows from the status hide produced', () => {
    const undo = inverseOf('hide')

    expect(undo !== null && canTransition(targetStatusFor('hide'), targetStatusFor(undo))).toBe(
      true,
    )
  })

  it.each(['publish', 'reject'] as const)(
    'offers no inverse for %s, whose resulting status has several possible predecessors',
    (decision) => {
      expect(inverseOf(decision)).toBeNull()
    },
  )
})

describe('allowedDecisionsFrom', () => {
  it.each([
    ['pending', ['publish', 'reject']],
    ['published', ['reject', 'hide']],
    ['rejected', ['publish']],
    ['hidden', ['publish', 'reject']],
  ] as const)('offers a %s photo exactly the decisions %j', (status, expected) => {
    expect(allowedDecisionsFrom(status)).toEqual(expected)
  })

  it.each(PHOTO_STATUSES)(
    'offers a %s photo only decisions the status machine accepts, never a no-op',
    (status) => {
      for (const decision of allowedDecisionsFrom(status)) {
        expect(targetStatusFor(decision)).not.toBe(status)
        expect(canTransition(status, targetStatusFor(decision))).toBe(true)
      }
    },
  )

  it.each(PHOTO_STATUSES)(
    'leaves out no decision the status machine would accept for %s',
    (status) => {
      const offered = new Set(allowedDecisionsFrom(status))
      for (const decision of MODERATION_DECISIONS) {
        const target = targetStatusFor(decision)
        expect(offered.has(decision)).toBe(target !== status && canTransition(status, target))
      }
    },
  )
})
