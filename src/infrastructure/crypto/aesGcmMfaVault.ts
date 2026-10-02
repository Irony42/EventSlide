import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import type { MfaVault, SealedSecret } from '../../application/ports/mfaVault'

/**
 * `MfaVault` over `node:crypto`: AES-256-GCM, a random 96-bit IV per seal, and the key
 * derived from `MFA_ENCRYPTION_KEY` by HKDF-SHA-256 under a label of its own.
 *
 * **The format is `iv.tag.ciphertext`, each part base64url**, which is what migration 011's
 * `CHECK` expects: exactly two dots, nothing outside the base64url alphabet. The text is
 * therefore self-describing enough that a row holding a plaintext secret cannot be written.
 *
 * **Why a derived key and not the configured bytes.** The variable is "at least 32 random
 * bytes" in whichever encoding the operator found convenient, and AES-256 wants exactly 32.
 * HKDF turns any key of 32 bytes or more into one, and the label means that the same
 * `MFA_ENCRYPTION_KEY` could never also be a key for something else this product derives.
 *
 * **Authenticated.** GCM's tag is checked before any plaintext is released, and the key
 * version is bound in as associated data, so a text cannot be re-labelled with another
 * version and still open. Everything that goes wrong on the way back — a truncated text, a
 * flipped bit, the wrong key, a version this vault holds no key for — is the same `null`.
 */

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32
const HKDF_LABEL = 'eventslide/mfa-secret/v1'

/** The vault only ever holds one key; a rotation would add a second to this and a second version. */
export const MFA_KEY_VERSION = 1

export interface AesGcmMfaVaultOptions {
  /** The decoded `MFA_ENCRYPTION_KEY`: 32 bytes or more. */
  readonly keyMaterial: Uint8Array
  readonly keyVersion?: number
}

const associatedData = (keyVersion: number): Buffer => Buffer.from(`v${keyVersion}`, 'utf8')

const BASE64URL = /^[A-Za-z0-9_-]+$/

export const createAesGcmMfaVault = ({
  keyMaterial,
  keyVersion = MFA_KEY_VERSION,
}: AesGcmMfaVaultOptions): MfaVault => {
  if (keyMaterial.length < KEY_BYTES) {
    throw new Error(`the MFA encryption key must be at least ${KEY_BYTES} bytes`)
  }
  const key = Buffer.from(
    hkdfSync('sha256', keyMaterial, Buffer.alloc(0), Buffer.from(HKDF_LABEL, 'utf8'), KEY_BYTES),
  )

  return {
    seal: (plaintext: Uint8Array): SealedSecret => {
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES })
      cipher.setAAD(associatedData(keyVersion))
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
      const tag = cipher.getAuthTag()

      return {
        sealed: [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.'),
        keyVersion,
      }
    },

    open: (sealed: string, version: number): Uint8Array | null => {
      if (version !== keyVersion) return null

      const parts = sealed.split('.')
      if (parts.length !== 3 || !parts.every((part) => BASE64URL.test(part))) return null
      const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64url'))
      if (iv === undefined || tag === undefined || ciphertext === undefined) return null
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null

      try {
        const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES })
        decipher.setAAD(associatedData(version))
        decipher.setAuthTag(tag)
        return Uint8Array.from(Buffer.concat([decipher.update(ciphertext), decipher.final()]))
      } catch {
        // The authentication tag did not verify. Nothing about why is worth saying: the
        // caller treats every cause alike, and the cause could be an attack.
        return null
      }
    },
  }
}
