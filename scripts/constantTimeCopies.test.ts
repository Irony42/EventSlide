import { describe, expect, it } from 'vitest'
import { constantTimeEqual as http } from '../src/interface/http/middleware/constantTime'
import { constantTimeEqual as infrastructure } from '../src/infrastructure/crypto/primitives'

/**
 * The HTTP layer may not import `infrastructure/crypto/primitives`, so it carries its own copy of
 * `constantTimeEqual` (`interface/http/middleware/constantTime.ts`). Two copies of a security
 * comparison are tolerable only while they are the same function; this runs one table through
 * both so that a change to either has to be made to both.
 */
const PAIRS: readonly (readonly [string, string])[] = [
  ['', ''],
  ['same', 'same'],
  ['abcd', 'abce'],
  ['Xbcd', 'Ybcd'],
  ['short', 'a longer one'],
  ['\u00e9', 'e'],
  ['\u0165', 'e'],
  ['\u00e9\u00e9', 'ee'],
  ['a\u0000b', 'a\u0000c'],
  ['\ud83d\ude00', '\ud83d\ude01'],
  ['x'.repeat(43), 'y'.repeat(43)],
  ['\u00e9'.repeat(43), 'e'.repeat(43)],
]

describe('the two constantTimeEqual copies', () => {
  it.each(PAIRS)('agree on %j against %j, in both orders, without throwing', (left, right) => {
    expect(http(left, right)).toBe(infrastructure(left, right))
    expect(http(right, left)).toBe(infrastructure(right, left))
  })
})
