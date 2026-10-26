import { describe, expect, it } from 'vitest'
import { MEDIA_KINDS } from './mediaKind'

describe('MediaKind', () => {
  it('is exactly the two things a wall row can be', () => {
    expect([...MEDIA_KINDS]).toEqual(['photo', 'clip'])
  })
})
