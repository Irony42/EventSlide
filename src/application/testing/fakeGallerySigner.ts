import type { GallerySigner, MintedShareToken } from '../ports/gallerySigner'

/**
 * A `GallerySigner` a ring-2 test can drive without a key.
 *
 * Deterministic — `token-1`, `token-2`, … — so an assertion names the exact link a host
 * was handed.
 *
 * It is **not** a pass-through: `verify` answers true only for the exact list of parts
 * that was signed, length-prefixed the way the real adapter does it, so `['ab', 'c']`
 * and `['a', 'bc']` differ here too. The shared contract suite runs the same cases
 * against this and against the HMAC adapter, which is what keeps a use case test from
 * proving a tamper is refused while production let it through.
 *
 * The one thing it cannot fake is secrecy — anybody can compute these signatures. That is
 * what the ring-3 and ring-4 tests against the real adapter are for.
 */

/** Each part as `<length>:<part>`, so no boundary between two parts can be moved. */
const canonical = (parts: readonly string[]): string =>
  parts.map((part) => `${part.length}:${part}`).join('')

/** Hex of the UTF-16 code units: URL-safe, as the port requires, and still reversible. */
const hex = (text: string): string =>
  [...text].map((character) => character.charCodeAt(0).toString(16).padStart(4, '0')).join('')

export class FakeGallerySigner implements GallerySigner {
  private minted = 0

  mintToken(): MintedShareToken {
    this.minted += 1
    const token = `token-${this.minted}`
    return { token, digest: this.digestOf(token) }
  }

  /**
   * A stand-in digest in the shape the domain insists on: 64 lower-case hex characters.
   *
   * Injective for anything up to sixteen characters, which covers every token this fake
   * mints; a test that needs the digest of a longer string is asking about the real hash.
   */
  digestOf(token: string): string {
    return hex(token).padEnd(64, 'f').slice(0, 64)
  }

  sign(parts: readonly string[]): string {
    return `sig-${hex(canonical(parts))}`
  }

  verify(parts: readonly string[], signature: string): boolean {
    return signature === this.sign(parts)
  }
}
