import type { MintedToken, SecretTokens } from '../../application/ports/secretTokens'
import { constantTimeEqual, randomToken, sha256Hex } from './primitives'

/**
 * `SecretTokens` over `node:crypto`: 256 random bits, stored as their SHA-256.
 *
 * The shared gallery's links are minted by this adapter too (`hmacGallerySigner.mintToken`
 * delegates here), so there is one construction. A gallery signs statements with a secret derived from `SESSION_SECRET`;
 * a token here is only ever compared with its own digest, so a keyed hash would add a way
 * to lose every outstanding link (rotating the secret) without adding anything an attacker
 * who holds the database could not already do — which, with a digest of 256 random bits, is
 * nothing at all.
 */

const TOKEN_BYTES = 32

/** SHA-256 as hex is always 64 characters. Anything else is not one of ours. */
const DIGEST_LENGTH = 64

const digestOf = (token: string): string => sha256Hex(token)

export const sha256SecretTokens: SecretTokens = {
  mint: (): MintedToken => {
    const token = randomToken(TOKEN_BYTES)
    return { token, digest: digestOf(token) }
  },

  digestOf,

  verify: (token: string, digest: string): boolean => {
    // The length of a SHA-256 digest is public, so refusing on it leaks nothing.
    if (digest.length !== DIGEST_LENGTH) return false
    return constantTimeEqual(digestOf(token), digest)
  },
}
