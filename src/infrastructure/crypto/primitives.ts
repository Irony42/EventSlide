import { createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * The few operations every adapter in this folder is made of, written once.
 *
 * Each of them was written three to five times, by hand, and a copy is where a security
 * property goes missing: a length check dropped from one comparison, an HKDF salt chosen
 * differently in one adapter than in the next. The adapters keep what is theirs (their key
 * label, their encoding, their error) and take these for the rest.
 */

const KEY_BYTES = 32

/**
 * A 32-byte key for one purpose, derived from a secret the box already holds with HKDF-SHA256
 * and an empty salt.
 *
 * The `label` is the domain separation: the same secret under two labels gives two keys that
 * share nothing, so something signed for one purpose cannot be replayed as another, and the
 * parent cannot be recovered from either.
 */
export const deriveKey = (rootSecret: string | Uint8Array, label: string): Buffer =>
  Buffer.from(hkdfSync('sha256', rootSecret, Buffer.alloc(0), label, KEY_BYTES))

/**
 * Whether two strings are the same, in time that does not depend on where they first differ.
 *
 * Compared as UTF-8 **bytes**, and the byte lengths are checked first because
 * `timingSafeEqual` throws when they differ. A check on `string.length` is not that check: one
 * two-byte character against one one-byte character has the same length. The length of what is
 * being compared (a MAC, a digest, a token) is public, so refusing on it leaks nothing.
 */
export const constantTimeEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b))
}

/** The SHA-256 of text (as UTF-8) or of bytes, as lower-case hex. */
export const sha256Hex = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex')

/** `bytes` random bytes as base64url, without padding: what goes in a URL or a cookie. */
export const randomToken = (bytes: number): string => randomBytes(bytes).toString('base64url')
