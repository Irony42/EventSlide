import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import type { GallerySigner, MintedShareToken } from '../../application/ports/gallerySigner'

/**
 * HMAC-SHA256 for the shared gallery: tokens, their digests, and every signed statement a
 * gallery hands out (docs/ROADMAP.md §4.1).
 *
 * ## The key
 *
 * Derived from `SESSION_SECRET` with HKDF under a label of its own, rather than read from
 * a new variable. A new *required* secret would refuse to boot every existing
 * installation on upgrade — the production posture refuses a missing secret rather than
 * inventing one (AGENTS.md #17) — and an *optional* one would need a fallback, which is
 * the constant this repository has already had to remove once. Deriving costs neither:
 *
 * - **Domain separation is real.** HKDF with the `eventslide/gallery/v1` label yields a key
 *   no other part of the product uses, so nothing `express-session` signs can be replayed
 *   as a gallery statement, and the other way round.
 * - **The parent cannot be recovered from it.** A leak of the derived key forges gallery
 *   URLs and nothing else.
 * - **The strongest secret on the box.** A leak of `SESSION_SECRET` already forges host
 *   sessions, which is strictly worse than anything a gallery grant allows, so hanging the
 *   gallery off it adds no new way in. `GUEST_TOKEN_SECRET` was the other candidate and is
 *   the weaker parent for exactly that reason: its leak should cost a guest's upload rights,
 *   not the password on somebody's album.
 * - Rotating `SESSION_SECRET` voids every outstanding media URL and unlock cookie, which
 *   is the right side of that trade: they are short-lived by design.
 *
 * ## The encoding
 *
 * Each part is length-prefixed (`<utf-8 bytes>:<part>`) before it is MACed, so no
 * boundary between two parts can be moved and no statement is a prefix of another. The
 * first part names the purpose; see the port.
 */

const TOKEN_BYTES = 32
const KEY_BYTES = 32
const LABEL = 'eventslide/gallery/v1'

/** A base64url HMAC-SHA256 is always 43 characters. Anything else is not one of ours. */
const SIGNATURE_LENGTH = 43

export interface HmacGallerySignerOptions {
  /** `SESSION_SECRET`. At least 32 characters, like every secret this box accepts. */
  readonly rootSecret: string
}

const canonical = (parts: readonly string[]): Buffer =>
  Buffer.concat(
    parts.map((part) => {
      const bytes = Buffer.from(part, 'utf8')
      return Buffer.concat([Buffer.from(`${bytes.length}:`, 'utf8'), bytes])
    }),
  )

export const createHmacGallerySigner = ({
  rootSecret,
}: HmacGallerySignerOptions): GallerySigner => {
  if (rootSecret.length < 32) {
    // The same refusal the guest token adapter makes: a short key signs, it just signs
    // with something guessable, and nothing downstream would notice.
    throw new Error('the gallery signing key must be derived from a secret of 32+ characters')
  }

  const key = Buffer.from(hkdfSync('sha256', rootSecret, Buffer.alloc(0), LABEL, KEY_BYTES))

  const mac = (parts: readonly string[]): string =>
    createHmac('sha256', key).update(canonical(parts)).digest('base64url')

  const digestOf = (token: string): string =>
    createHash('sha256').update(token, 'utf8').digest('hex')

  return {
    mintToken: (): MintedShareToken => {
      const token = randomBytes(TOKEN_BYTES).toString('base64url')
      return { token, digest: digestOf(token) }
    },

    digestOf,

    sign: mac,

    verify: (parts: readonly string[], signature: string): boolean => {
      // Length first: `timingSafeEqual` throws on a mismatch, and the length of an HMAC is
      // public, so checking it leaks nothing an attacker did not already know.
      if (signature.length !== SIGNATURE_LENGTH) return false
      const expected = Buffer.from(mac(parts), 'utf8')
      const provided = Buffer.from(signature, 'utf8')
      if (expected.length !== provided.length) return false
      return timingSafeEqual(new Uint8Array(expected), new Uint8Array(provided))
    },
  }
}
