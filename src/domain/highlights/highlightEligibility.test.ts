import { describe, expect, it } from 'vitest'
import { PHOTO_STATUSES } from '../photos/photoStatus'
import { isHighlightable, isReelEligible } from './highlightEligibility'

describe('isHighlightable', () => {
  it('accepts a published photograph', () => {
    expect(isHighlightable('published')).toBe(true)
  })

  it.each(PHOTO_STATUSES.filter((status) => status !== 'published'))(
    'refuses a %s photograph, so a best-of never carries what is off the wall',
    (status) => {
      expect(isHighlightable(status)).toBe(false)
    },
  )
})

describe('isReelEligible', () => {
  it('accepts a published photograph', () => {
    expect(isReelEligible('published', 'photo')).toBe(true)
  })

  it('refuses a published clip: the montage is made of stills', () => {
    expect(isReelEligible('published', 'clip')).toBe(false)
  })

  it.each(PHOTO_STATUSES.filter((status) => status !== 'published'))(
    'refuses a %s photograph',
    (status) => {
      expect(isReelEligible(status, 'photo')).toBe(false)
    },
  )
})
