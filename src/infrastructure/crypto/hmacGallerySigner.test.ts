import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { gallerySignerContract } from '../../application/testing/contracts/gallerySignerContract'
import { createHmacGallerySigner } from './hmacGallerySigner'

const SECRET = 'a-session-secret-that-is-long-enough-for-tests'

gallerySignerContract('hmac', () => createHmacGallerySigner({ rootSecret: SECRET }))

describe('createHmacGallerySigner', () => {
  const STATEMENT = ['media', 'link-1', 'photo-1', 'original', '1782000000000']

  it('refuses a key derived from a short secret, rather than signing with it', () => {
    expect(() => createHmacGallerySigner({ rootSecret: 'too-short' })).toThrow(/32/)
  })

  it('stores a token as its SHA-256, so the digest a lookup compares is reproducible', () => {
    const signer = createHmacGallerySigner({ rootSecret: SECRET })
    const minted = signer.mintToken()

    expect(minted.digest).toBe(createHash('sha256').update(minted.token).digest('hex'))
  })

  it('mints 256 bits of entropy per token', () => {
    const signer = createHmacGallerySigner({ rootSecret: SECRET })

    expect(Buffer.from(signer.mintToken().token, 'base64url')).toHaveLength(32)
  })

  it('refuses a signature made under another box’s secret', () => {
    // The property a stateless signature exists for: nobody without the key can mint one.
    const ours = createHmacGallerySigner({ rootSecret: SECRET })
    const theirs = createHmacGallerySigner({ rootSecret: `${SECRET}-somewhere-else` })

    expect(ours.verify(STATEMENT, theirs.sign(STATEMENT))).toBe(false)
  })

  it('agrees with itself across two instances built from one secret', () => {
    // A restart must not void the URLs a guest's open page is still holding.
    const before = createHmacGallerySigner({ rootSecret: SECRET })
    const after = createHmacGallerySigner({ rootSecret: SECRET })

    expect(after.verify(STATEMENT, before.sign(STATEMENT))).toBe(true)
  })

  it('never signs with the session secret itself', () => {
    // Domain separation: an HMAC keyed by the raw session secret is what
    // `express-session`'s cookie signature is, and the two must never coincide.
    const signer = createHmacGallerySigner({ rootSecret: SECRET })
    const naive = createHmac('sha256', SECRET).update('5:media').digest('base64url')

    expect(signer.sign(['media'])).not.toBe(naive)
  })
})
