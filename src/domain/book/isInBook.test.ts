import { describe, expect, it } from 'vitest'
import { PHOTO_STATUSES } from '../photos/photoStatus'
import { isInBook } from './isInBook'

describe('isInBook', () => {
  it('takes published photographs and nothing else, hidden and rejected included', () => {
    expect(PHOTO_STATUSES.filter(isInBook)).toEqual(['published'])
  })
})
