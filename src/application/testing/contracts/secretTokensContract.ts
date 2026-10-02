import { beforeEach, describe, expect, it } from 'vitest'
import type { SecretTokens } from '../../ports/secretTokens'

/**
 * The shared `SecretTokens` contract, run against the real adapter and the deterministic
 * fake. What has to hold in both is the shape of a digest (the schema's `CHECK` refuses
 * anything else) and what `verify` does with a token that is not the digest's own — the
 * cases a use-case test relies on being true of production.
 *
 * What only the real adapter can promise — 256 bits of entropy — is asserted in its own
 * test, not here: the fake is deterministic on purpose.
 */

const HEX_DIGEST = /^[0-9a-f]{64}$/
const URL_SAFE = /^[A-Za-z0-9_-]+$/

export const secretTokensContract = (name: string, makeSubject: () => SecretTokens): void => {
  describe(`SecretTokens contract: ${name}`, () => {
    let tokens: SecretTokens

    beforeEach(() => {
      tokens = makeSubject()
    })

    it('mints a URL-safe token with a digest of 64 lower-case hex characters', () => {
      const { token, digest } = tokens.mint()

      expect(token).toMatch(URL_SAFE)
      expect(digest).toMatch(HEX_DIGEST)
    })

    it('gives the digest it minted when asked for the digest of that token', () => {
      const { token, digest } = tokens.mint()

      expect(tokens.digestOf(token)).toBe(digest)
    })

    it('mints a different token and digest every time', () => {
      const minted = Array.from({ length: 20 }, () => tokens.mint())

      expect(new Set(minted.map((entry) => entry.token)).size).toBe(20)
      expect(new Set(minted.map((entry) => entry.digest)).size).toBe(20)
    })

    it('never maps two tokens to one digest', () => {
      const [first, second] = [tokens.mint(), tokens.mint()]

      expect(tokens.digestOf(first.token)).not.toBe(tokens.digestOf(second.token))
    })

    it('verifies a token against its own digest', () => {
      const { token, digest } = tokens.mint()

      expect(tokens.verify(token, digest)).toBe(true)
    })

    it('refuses another token against that digest', () => {
      const { digest } = tokens.mint()
      const other = tokens.mint()

      expect(tokens.verify(other.token, digest)).toBe(false)
    })

    it('refuses a digest that differs by a single character', () => {
      const { token, digest } = tokens.mint()
      const flipped = `${digest.slice(0, 63)}${digest.endsWith('0') ? '1' : '0'}`

      expect(tokens.verify(token, flipped)).toBe(false)
    })

    it.each([
      ['an empty digest', ''],
      ['a digest that is too short', 'abc123'],
      ['a digest that is too long', 'a'.repeat(65)],
      ['a digest in upper case', 'A'.repeat(64)],
    ])('refuses %s without throwing', (_label, digest) => {
      const { token } = tokens.mint()

      expect(tokens.verify(token, digest)).toBe(false)
    })

    it('refuses the upper-case spelling of the right digest, which is a different string', () => {
      const { token, digest } = tokens.mint()
      // Only meaningful when the digest has a letter in it; the real hash and the fake's
      // padding both do for any token this suite mints.
      const shouted = digest.toUpperCase()

      expect(shouted).not.toBe(digest)
      expect(tokens.verify(token, shouted)).toBe(false)
    })
  })
}
