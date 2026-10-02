import type { MintedToken, SecretTokens } from '../ports/secretTokens'

/**
 * A `SecretTokens` a ring-2 test can drive without randomness.
 *
 * Deterministic — `secret-1`, `secret-2`, … — so an assertion can name the exact token a mail
 * carried instead of parsing it out. It is **not** a pass-through: `verify` answers true only
 * for the digest of that exact token, and the shared contract suite
 * (`contracts/secretTokensContract.ts`) runs the same cases against this and against the
 * real adapter, which is what keeps a use-case test from passing with a comparison
 * production does not make.
 *
 * The one thing it cannot fake is secrecy: anybody can compute these digests.
 */

/** Hex of the UTF-16 code units: injective, and in the shape the schema insists on. */
const hex = (text: string): string =>
  [...text].map((character) => character.charCodeAt(0).toString(16).padStart(4, '0')).join('')

export class FakeSecretTokens implements SecretTokens {
  private minted = 0

  mint(): MintedToken {
    this.minted += 1
    const token = `secret-${this.minted}`
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

  verify(token: string, digest: string): boolean {
    return digest === this.digestOf(token)
  }
}
