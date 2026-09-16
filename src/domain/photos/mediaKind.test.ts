import { describe, expect, it } from 'vitest'
import { MEDIA_KINDS, isMediaKind } from './mediaKind'

describe('MediaKind', () => {
  it('is exactly the two things a wall row can be', () => {
    expect([...MEDIA_KINDS]).toEqual(['photo', 'clip'])
  })

  it.each([...MEDIA_KINDS])('accepts %s', (kind) => {
    expect(isMediaKind(kind)).toBe(true)
  })

  it('refuses a string that is not a kind', () => {
    // The guard exists for a database row and for a parsed request; a value that is
    // merely plausible must not become a kind the lookup tables have no column for.
    expect(isMediaKind('video')).toBe(false)
  })

  it('refuses a value that is not a string at all', () => {
    expect(isMediaKind(null)).toBe(false)
  })
})
