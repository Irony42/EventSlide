import { describe, expect, it } from 'vitest'
import { constantTimeEqual } from './constantTime'

describe('constantTimeEqual', () => {
  it('is true for the same text, including none', () => {
    expect(constantTimeEqual('same', 'same')).toBe(true)
    expect(constantTimeEqual('', '')).toBe(true)
  })

  it('is false for text of the same length that differs', () => {
    expect(constantTimeEqual('abcd', 'abce')).toBe(false)
  })

  it('is false, and does not throw, for text of another length', () => {
    expect(constantTimeEqual('short', 'a longer one')).toBe(false)
    expect(constantTimeEqual('', 'x')).toBe(false)
  })

  it('compares bytes, so the same number of characters in different bytes is a refusal and not a throw', () => {
    expect(constantTimeEqual('\u00e9', 'e')).toBe(false)
  })
})
