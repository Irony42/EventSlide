import { describe, expect, it } from 'vitest'
import { canTransition, isPhotoStatus } from '../photos/photoStatus'
import {
  inverseOf,
  isModerationDecision,
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

describe('isModerationDecision', () => {
  it.each(MODERATION_DECISIONS)('accepts %s', (decision) => {
    expect(isModerationDecision(decision)).toBe(true)
  })

  it('refuses a photo status, which is not something a client may decide', () => {
    expect(isModerationDecision('published')).toBe(false)
  })

  it('refuses a payload that is not a string', () => {
    expect(isModerationDecision(null)).toBe(false)
  })
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
