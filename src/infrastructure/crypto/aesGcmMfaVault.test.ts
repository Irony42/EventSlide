import { describe, expect, it } from 'vitest'
import { createAesGcmMfaVault } from './aesGcmMfaVault'

/**
 * Ring 3. The vault's whole job is the sentence "what comes back is what went in, or
 * nothing", so every case here is a way of handing it something else.
 */

const KEY = new Uint8Array(32).fill(7)
const OTHER_KEY = new Uint8Array(32).fill(8)
const SECRET = new TextEncoder().encode('12345678901234567890')

const vault = createAesGcmMfaVault({ keyMaterial: KEY })

/** Flips one bit of the byte at `index` in the base64url part `partIndex` of a sealed text. */
const tampered = (sealed: string, partIndex: number): string => {
  const parts = sealed.split('.')
  const bytes = Buffer.from(parts[partIndex] ?? '', 'base64url')
  bytes[0] = (bytes[0] ?? 0) ^ 1
  parts[partIndex] = bytes.toString('base64url')
  return parts.join('.')
}

describe('createAesGcmMfaVault', () => {
  it('opens what it sealed', () => {
    const { sealed, keyVersion } = vault.seal(SECRET)

    expect(vault.open(sealed, keyVersion)).toEqual(SECRET)
  })

  it('writes iv.tag.ciphertext in base64url: exactly the shape migration 011 insists on', () => {
    const { sealed } = vault.seal(SECRET)

    expect(sealed).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    const [iv, tag, ciphertext] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'))
    expect([iv?.length, tag?.length, ciphertext?.length]).toEqual([12, 16, SECRET.length])
  })

  it('does not contain the secret, in the clear or as base32 or base64', () => {
    const { sealed } = vault.seal(SECRET)

    expect(sealed).not.toContain('12345678901234567890')
    expect(sealed).not.toContain(Buffer.from(SECRET).toString('base64url'))
    expect(sealed).not.toContain('GEZDGNBVGY3TQOJQ')
  })

  it('uses a fresh IV every time, so sealing one secret twice gives two different texts', () => {
    const first = vault.seal(SECRET).sealed
    const second = vault.seal(SECRET).sealed

    expect(first).not.toBe(second)
    expect(first.split('.')[0]).not.toBe(second.split('.')[0])
  })

  it('names the key version it sealed under', () => {
    expect(vault.seal(SECRET).keyVersion).toBe(1)
  })

  it.each([
    ['the IV', 0],
    ['the authentication tag', 1],
    ['the ciphertext', 2],
  ])('opens nothing when a bit of %s was changed', (_part, index) => {
    const { sealed, keyVersion } = vault.seal(SECRET)

    expect(vault.open(tampered(sealed, index), keyVersion)).toBeNull()
  })

  it('opens nothing sealed under another key', () => {
    const { sealed, keyVersion } = createAesGcmMfaVault({ keyMaterial: OTHER_KEY }).seal(SECRET)

    expect(vault.open(sealed, keyVersion)).toBeNull()
  })

  it('opens nothing under a key version it holds no key for', () => {
    const { sealed } = vault.seal(SECRET)

    expect(vault.open(sealed, 2)).toBeNull()
    expect(vault.open(sealed, 0)).toBeNull()
  })

  it('binds the version into the text: relabelling it cannot make another vault open it', () => {
    const v2 = createAesGcmMfaVault({ keyMaterial: KEY, keyVersion: 2 })
    const { sealed } = vault.seal(SECRET)

    // The same key and the same bytes, claimed as version 2: the associated data differs.
    expect(v2.open(sealed, 2)).toBeNull()
  })

  it.each([
    '',
    'abc',
    'a.b',
    'a.b.c.d',
    '..',
    'AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA',
    'AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA==.AAAA',
    'not base64 at all.nor this.nor this',
  ])('answers null, and does not throw, for the malformed text %j', (text) => {
    expect(vault.open(text, 1)).toBeNull()
  })

  it('opens nothing from a truncated text', () => {
    const { sealed } = vault.seal(SECRET)

    expect(vault.open(sealed.slice(0, -2), 1)).toBeNull()
  })

  it('refuses to be built on a key shorter than 32 bytes, without saying what it was', () => {
    const construct = (): unknown => createAesGcmMfaVault({ keyMaterial: new Uint8Array(31) })

    expect(construct).toThrow(/at least 32 bytes/)
  })

  it('takes a longer key than 32 bytes, and a different key gives a different vault', () => {
    const long = createAesGcmMfaVault({ keyMaterial: new Uint8Array(48).fill(7) })
    const { sealed } = long.seal(SECRET)

    expect(long.open(sealed, 1)).toEqual(SECRET)
    expect(vault.open(sealed, 1)).toBeNull()
  })
})
