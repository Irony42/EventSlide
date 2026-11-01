import { describe, expect, it } from 'vitest'
import { PHOTO_STATUSES } from '../photos/photoStatus'
import { isHighlightable } from './highlightEligibility'

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
