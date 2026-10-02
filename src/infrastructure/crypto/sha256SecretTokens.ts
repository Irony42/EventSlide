import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { MintedToken, SecretTokens } from '../../application/ports/secretTokens'

/**
 * `SecretTokens` over `node:crypto`: 256 random bits, stored as their SHA-256.
 *
 * The same construction as the shared gallery's links (`hmacGallerySigner.mintToken`),
 * minus the key. A gallery signs statements with a secret derived from `SESSION_SECRET`;
 * a token here is only ever compared with its own digest, so a keyed hash would add a way
 * to lose every outstanding link (rotating the secret) without adding anything an attacker
 * who holds the database could not already do — which, with a digest of 256 random bits, is
 * nothing at all.
 */

const TOKEN_BYTES = 32

/** SHA-256 as hex is always 64 characters. Anything else is not one of ours. */
const DIGEST_LENGTH = 64

const digestOf = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex')

export const sha256SecretTokens: SecretTokens = {
  mint: (): MintedToken => {
    const token = randomBytes(TOKEN_BYTES).toString('base64url')
    return { token, digest: digestOf(token) }
  },

  digestOf,

  verify: (token: string, digest: string): boolean => {
    // Length first: `timingSafeEqual` throws on a mismatch, and the length of a SHA-256
    // digest is public, so checking it leaks nothing an attacker did not already know.
    if (digest.length !== DIGEST_LENGTH) return false
    const expected = Buffer.from(digestOf(token), 'utf8')
    const provided = Buffer.from(digest, 'utf8')
    if (expected.length !== provided.length) return false
    return timingSafeEqual(new Uint8Array(expected), new Uint8Array(provided))
  },
}
