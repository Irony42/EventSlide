import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { secretTokensContract } from '../../application/testing/contracts/secretTokensContract'
import { sha256SecretTokens } from './sha256SecretTokens'

secretTokensContract('sha256', () => sha256SecretTokens)

describe('sha256SecretTokens', () => {
  it('mints 256 bits of randomness: 32 bytes, 43 base64url characters, no padding', () => {
    const { token } = sha256SecretTokens.mint()

    expect(token).toHaveLength(43)
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
  })

  it('does not repeat itself across a thousand mints', () => {
    const seen = new Set(Array.from({ length: 1_000 }, () => sha256SecretTokens.mint().token))

    expect(seen.size).toBe(1_000)
  })

  it('stores the SHA-256 of the token, as an independent computation gives it', () => {
    const { token, digest } = sha256SecretTokens.mint()

    expect(digest).toBe(createHash('sha256').update(token, 'utf8').digest('hex'))
  })

  it('does not put the token in its digest', () => {
    const { token, digest } = sha256SecretTokens.mint()

    expect(digest).not.toContain(token)
    expect(digest).not.toBe(token)
  })
})
