import { describe, expect, it } from 'vitest'
import type { MfaVault } from '../../ports/mfaVault'

/**
 * The shared `MfaVault` contract, run against the in-memory fake and the AES-256-GCM adapter.
 *
 * What has to behave the same is the promise the use cases build on: **what comes back is what
 * went in, or nothing**. A fake that opened a text it should have refused would let every
 * use-case test pass against a vault that returned garbage to a login.
 *
 * Both subjects are handed the same pair of vaults: two that hold different keys, because
 * "sealed under another key opens to nothing" cannot be stated about one vault.
 */

const SECRET = new TextEncoder().encode('12345678901234567890')

export const mfaVaultContract = (
  name: string,
  makeVaults: () => { readonly vault: MfaVault; readonly stranger: MfaVault },
): void => {
  describe(`MfaVault contract: ${name}`, () => {
    it('opens what it sealed', () => {
      const { vault } = makeVaults()
      const { sealed, keyVersion } = vault.seal(SECRET)

      expect(vault.open(sealed, keyVersion)).toEqual(SECRET)
    })

    it('writes the shape the table insists on: iv.tag.ciphertext, exactly two dots, base64url', () => {
      const { vault } = makeVaults()

      expect(vault.seal(SECRET).sealed).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    })

    it('does not write the secret in the clear', () => {
      const { vault } = makeVaults()
      const { sealed } = vault.seal(SECRET)

      expect(sealed).not.toContain('12345678901234567890')
      expect(sealed).not.toContain(Buffer.from(SECRET).toString('base64url'))
    })

    it('seals one secret to two different texts', () => {
      const { vault } = makeVaults()

      expect(vault.seal(SECRET).sealed).not.toBe(vault.seal(SECRET).sealed)
    })

    it('opens nothing that another key sealed', () => {
      const { vault, stranger } = makeVaults()
      const { sealed, keyVersion } = stranger.seal(SECRET)

      expect(vault.open(sealed, keyVersion)).toBeNull()
    })

    it('opens nothing under a key version it holds no key for', () => {
      const { vault } = makeVaults()
      const { sealed } = vault.seal(SECRET)

      expect(vault.open(sealed, 99)).toBeNull()
    })

    it('opens nothing from a text it did not write', () => {
      const { vault } = makeVaults()

      for (const text of ['', 'abc', 'a.b', 'a.b.c.d', 'GEZDGNBVGY3TQOJQ']) {
        expect(vault.open(text, 1)).toBeNull()
      }
    })

    it.each([0, 1, 2])('opens nothing when the first character of part %i is changed', (index) => {
      const { vault } = makeVaults()
      const { sealed, keyVersion } = vault.seal(SECRET)
      const parts = sealed.split('.')
      const part = parts[index] ?? ''
      // The first character, not the last: the last may carry only padding bits, which a lenient
      // decoder ignores, and a change there is a different text for the same bytes.
      parts[index] = `${part.startsWith('A') ? 'B' : 'A'}${part.slice(1)}`

      expect(vault.open(parts.join('.'), keyVersion)).toBeNull()
    })
  })
}
