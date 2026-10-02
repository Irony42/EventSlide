import { describe, expect, it } from 'vitest'
import { decodeBase32, encodeBase32 } from './base32'

/** ASCII only, which is all the vectors are: the domain project has no `TextEncoder`. */
const bytesOf = (text: string): Uint8Array =>
  Uint8Array.from([...text].map((character) => character.charCodeAt(0)))

/** RFC 4648 section 10: the test vectors the standard itself publishes. */
const RFC_4648_VECTORS: readonly (readonly [string, string])[] = [
  ['', ''],
  ['f', 'MY======'],
  ['fo', 'MZXQ===='],
  ['foo', 'MZXW6==='],
  ['foob', 'MZXW6YQ='],
  ['fooba', 'MZXW6YTB'],
  ['foobar', 'MZXW6YTBOI======'],
]

describe('base32 (RFC 4648)', () => {
  it.each(RFC_4648_VECTORS)('encodes %j as %s with padding', (plain, encoded) => {
    expect(encodeBase32(bytesOf(plain), true)).toBe(encoded)
  })

  it.each(RFC_4648_VECTORS)('encodes %j without padding by default', (plain, encoded) => {
    expect(encodeBase32(bytesOf(plain))).toBe(encoded.replace(/=+$/, ''))
  })

  it.each(RFC_4648_VECTORS)('decodes %s back to %j', (plain, encoded) => {
    const decoded = decodeBase32(encoded)
    expect(decoded === null ? null : String.fromCharCode(...decoded)).toBe(plain)
  })

  it('decodes the unpadded spelling as well as the padded one', () => {
    expect(decodeBase32('MZXW6YQ')).toEqual(bytesOf('foob'))
  })

  it('reads lower case and the spaces an authenticator app prints between groups', () => {
    expect(decodeBase32('mzxw 6ytb')).toEqual(bytesOf('fooba'))
  })

  it('round-trips every length of secret, including the 20 bytes of an HMAC-SHA1 key', () => {
    for (let length = 0; length <= 40; length += 1) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) % 256)
      expect(decodeBase32(encodeBase32(bytes))).toEqual(bytes)
    }
  })

  it('refuses a character outside the alphabet, including the digits base32 leaves out', () => {
    expect(decodeBase32('MZXW6YT!')).toBeNull()
    expect(decodeBase32('MZXW1YTB')).toBeNull()
    expect(decodeBase32('MZXW8YTB')).toBeNull()
  })

  it('refuses a length no whole number of bytes can have', () => {
    for (const text of ['M', 'MZX', 'MZXW6Y']) expect(decodeBase32(text)).toBeNull()
  })

  it('refuses a text whose last symbol carries bits an encoder would have left at zero', () => {
    // "MY" is "f" followed by a zero tail; "M7" has the same length and a non-zero one.
    expect(decodeBase32('MY')).toEqual(bytesOf('f'))
    expect(decodeBase32('M7')).toBeNull()
  })
})
