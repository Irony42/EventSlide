import { timingSafeEqual } from 'node:crypto'

/**
 * Whether two strings are the same, in time that does not depend on where they first differ.
 *
 * The HTTP layer's own copy of `constantTimeEqual` in `infrastructure/crypto/primitives.ts`,
 * which it may not import (an adapter reaches the HTTP layer through the container, not the
 * other way round). The CSRF check and the trusted-device cookie share this one, so the layer
 * has the one comparison rather than two.
 *
 * Compared as UTF-8 **bytes**, with the byte lengths checked first: `timingSafeEqual` throws
 * when they differ, and one two-byte character against one one-byte character has the same
 * length as a string. A throw would be a 500 for a forged value where an honest one gets a 4xx.
 * The length of what is compared (a token, a MAC) is public, so refusing on it leaks nothing.
 */
export const constantTimeEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b))
}
