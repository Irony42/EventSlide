import type { MfaVault, SealedSecret } from '../ports/mfaVault'

/**
 * An `MfaVault` a ring-2 test can drive without a key schedule.
 *
 * **Not encryption, and not secret**: the "ciphertext" is the plaintext XOR a constant, so a
 * test can read what a use case stored if it wants to. What it does keep is the vault's
 * *contract* (`contracts/mfaVaultContract.ts` runs the same cases against this and against the
 * real adapter): a text opens only under the key it was sealed with, a changed character in
 * any part opens nothing, and two seals of one secret differ. That is what stops a use-case
 * test from passing with a vault that returns whatever it is given.
 *
 * Two fakes with different `key` labels stand for two different keys.
 */

const MASK = 0x5a

const toText = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url')

/**
 * A checksum of the key label, the key version and everything it covers: the stand-in for GCM's tag. FNV-1a, so
 * the fake needs no `node:crypto` and still changes when any character of the key, the IV or
 * the ciphertext does.
 */
const tagOf = (key: string, version: number, covered: string): string => {
  let hash = 0x811c9dc5
  for (const character of `${key}|v${version}|${covered}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0
  }
  return toText(Buffer.from(hash.toString(16).padStart(8, '0')))
}

export class FakeMfaVault implements MfaVault {
  private sealedCount = 0

  constructor(
    private readonly key = 'fake-key',
    private readonly keyVersion = 1,
  ) {}

  seal(plaintext: Uint8Array): SealedSecret {
    this.sealedCount += 1
    const iv = toText(Buffer.from(`iv${this.sealedCount}`))
    const ciphertext = toText(plaintext.map((byte) => byte ^ MASK))
    return {
      sealed: `${iv}.${tagOf(this.key, this.keyVersion, `${iv}${ciphertext}`)}.${ciphertext}`,
      keyVersion: this.keyVersion,
    }
  }

  open(sealed: string, version: number): Uint8Array | null {
    if (version !== this.keyVersion) return null
    const parts = sealed.split('.')
    const [iv, tag, ciphertext] = parts
    if (parts.length !== 3 || iv === undefined || tag === undefined || ciphertext === undefined) {
      return null
    }
    if (tag !== tagOf(this.key, version, `${iv}${ciphertext}`)) return null
    return Uint8Array.from(Buffer.from(ciphertext, 'base64url').map((byte) => byte ^ MASK))
  }
}
