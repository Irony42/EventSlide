import { describe, expect, it } from 'vitest'
import { constantTimeEqual, deriveKey, randomToken, sha256Hex } from './primitives'

describe('deriveKey', () => {
  it('is HKDF-SHA256 with an empty salt, the first 32 bytes of RFC 5869 test case 3', () => {
    // IKM of twenty-two 0x0b bytes, no salt, no info. The expansion of a longer output starts
    // with the same block, so the first 32 of the RFC's 42 bytes are what a 32-byte key is.
    expect(deriveKey('\x0b'.repeat(22), '').toString('hex')).toBe(
      '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d',
    )
  })

  it('is 32 bytes and the same every time for the same secret and label', () => {
    const first = deriveKey('a'.repeat(40), 'eventslide/test/v1')

    expect(first).toHaveLength(32)
    expect(deriveKey('a'.repeat(40), 'eventslide/test/v1').equals(first)).toBe(true)
  })

  it('gives each label its own key, which is what keeps one purpose from replaying as another', () => {
    const secret = 'a'.repeat(40)

    expect(
      deriveKey(secret, 'eventslide/one/v1').equals(deriveKey(secret, 'eventslide/two/v1')),
    ).toBe(false)
  })

  it('gives each secret its own key', () => {
    expect(deriveKey('a'.repeat(40), 'label').equals(deriveKey('b'.repeat(40), 'label'))).toBe(
      false,
    )
  })

  it('takes a secret as text or as the bytes of that text, and derives the same key from both', () => {
    const text = 'a secret of more than thirty-two characters'

    expect(
      deriveKey(new TextEncoder().encode(text), 'label').equals(deriveKey(text, 'label')),
    ).toBe(true)
  })
})

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
    // `timingSafeEqual` throws when its inputs differ in bytes. One character of two bytes against
    // one of one byte has the same length in characters, which is what a length check on strings
    // sees; the throw would be a 500 for a forged value where an honest one gets a 401.
    expect(constantTimeEqual('é', 'e')).toBe(false)
  })
})

describe('sha256Hex', () => {
  it('is the SHA-256 of the text, in lower-case hex', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('hashes the UTF-8 bytes of text and the bytes it is given', () => {
    expect(sha256Hex('é')).toBe(sha256Hex(new Uint8Array([0xc3, 0xa9])))
  })
})

describe('randomToken', () => {
  it('is base64url of that many random bytes, with no padding', () => {
    expect(randomToken(32)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(randomToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => randomToken(32)))

    expect(tokens.size).toBe(50)
  })
})
