/**
 * Encryption of a TOTP secret at rest (roadmap §10.1, G2-13 / P3-15).
 *
 * A port because the key and the cipher are infrastructure. What the use cases need is two
 * operations and one promise: `seal` turns a secret into text that is safe to store,
 * `open` turns it back, and **`open` answers `null` — never throws, never returns garbage —
 * for anything it did not seal**.
 *
 * ## What the adapter promises
 *
 * - **Authenticated encryption** (AES-256-GCM). A sealed text that was altered, truncated,
 *   cut from another row, or sealed under a different key opens to `null`, because the
 *   authentication tag is checked before anything is returned.
 * - **A fresh random IV per seal.** Sealing the same secret twice gives two different texts.
 * - **The key version travels with the text** so a rotation can tell which key sealed what.
 *   `open` answers `null` for a version the vault holds no key for, which is how a row sealed
 *   under a retired key is told apart from a corrupted one by the caller that asked.
 * - Nothing here logs, and no error carries the plaintext or the key.
 */

export interface SealedSecret {
  /** Opaque text to store. In the shipped adapter: `iv.tag.ciphertext`, base64url. */
  readonly sealed: string
  readonly keyVersion: number
}

export interface MfaVault {
  seal(plaintext: Uint8Array): SealedSecret
  open(sealed: string, keyVersion: number): Uint8Array | null
}
