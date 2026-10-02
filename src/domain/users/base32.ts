/**
 * RFC 4648 section 6 base32: the alphabet an authenticator app reads a shared secret in.
 *
 * Pure and dependency-free, so it belongs in the domain: `otpauth://` URIs carry the secret
 * as base32 text, and the one thing a user can do with a lost QR code is type it, so the
 * encoding is part of the product's contract and not an adapter's detail.
 *
 * No padding on output by default. Every authenticator app accepts a secret without `=`,
 * and a typed secret is shorter and has nothing to get wrong. {@link decodeBase32} accepts
 * both spellings.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

const INDEX: ReadonlyMap<string, number> = new Map(
  [...ALPHABET].map((character, index) => [character, index]),
)

const GROUP_BYTES = 5
const GROUP_CHARACTERS = 8

export const encodeBase32 = (bytes: Uint8Array, withPadding = false): string => {
  let output = ''
  let buffer = 0
  let bits = 0

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      output += ALPHABET.charAt((buffer >>> bits) & 31)
    }
    // Keep the accumulator small: only the bits not yet written matter.
    buffer &= (1 << bits) - 1
  }
  if (bits > 0) output += ALPHABET.charAt((buffer << (5 - bits)) & 31)

  if (!withPadding) return output
  const remainder = bytes.length % GROUP_BYTES
  if (remainder === 0) return output
  return output.padEnd(Math.ceil(output.length / GROUP_CHARACTERS) * GROUP_CHARACTERS, '=')
}

/**
 * The bytes a base32 text stands for, or `null` for anything that is not base32.
 *
 * Case-insensitive, and tolerant of the spaces an authenticator app prints between groups
 * and of trailing `=`; strict about everything else, including a length that no whole
 * number of bytes can produce.
 */
export const decodeBase32 = (text: string): Uint8Array | null => {
  const cleaned = text.replace(/\s+/g, '').toUpperCase().replace(/=+$/, '')

  let buffer = 0
  let bits = 0
  const bytes: number[] = []

  for (const character of cleaned) {
    const value = INDEX.get(character)
    if (value === undefined) return null
    buffer = (buffer << 5) | value
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >>> bits) & 255)
      buffer &= (1 << bits) - 1
    }
  }

  // Leftover bits must be the zero padding of an encoder, and fewer than a whole symbol's
  // worth: a length such as 1, 3 or 6 modulo 8 is not the encoding of any byte string.
  if (bits >= 5 || buffer !== 0) return null
  return Uint8Array.from(bytes)
}
