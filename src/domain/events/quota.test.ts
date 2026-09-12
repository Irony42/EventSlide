import { describe, expect, it } from 'vitest'
import { allowsAnotherPhoto, fitsInQuota, remainingQuota } from './quota'

/**
 * These three functions are the enforcing arithmetic: the copy of them that runs inside
 * the write transaction is what actually stops a public endpoint filling the disk. They
 * are tested here, once, rather than through each of their two callers.
 */
describe('remainingQuota', () => {
  it('reports what is left under the quota', () => {
    expect(remainingQuota(1_000, 400)).toBe(600)
  })

  it('reports nothing left rather than a negative number when usage passed the quota', () => {
    // The host lowered the quota after the party. A negative remaining shown to a guest,
    // or fed back into this arithmetic, is worse than an honest zero.
    expect(remainingQuota(1_000, 1_500)).toBe(0)
  })
})

describe('fitsInQuota', () => {
  it('accepts bytes that exactly reach the quota', () => {
    expect(fitsInQuota(1_000, 400, 600)).toBe(true)
  })

  it('refuses one byte past the quota', () => {
    expect(fitsInQuota(1_000, 400, 601)).toBe(false)
  })

  it('refuses anything once usage has already passed the quota', () => {
    expect(fitsInQuota(1_000, 1_500, 1)).toBe(false)
  })
})

describe('allowsAnotherPhoto', () => {
  it('allows any number when the event sets no cap', () => {
    expect(allowsAnotherPhoto(null, 9_000)).toBe(true)
  })

  it('allows one more while the author is under the cap', () => {
    expect(allowsAnotherPhoto(3, 2)).toBe(true)
  })

  it('refuses one more once the author has reached the cap', () => {
    expect(allowsAnotherPhoto(3, 3)).toBe(false)
  })
})
