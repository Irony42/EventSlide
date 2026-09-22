import { describe, expect, it } from 'vitest'
import type { GallerySigner } from '../../ports/gallerySigner'

/**
 * The behaviour every `GallerySigner` must have, run against the fake **and** the HMAC
 * adapter.
 *
 * The cases are the ways a signed statement gets forged in practice: change one field,
 * move a boundary between two fields, reuse a signature minted for another purpose, send
 * garbage. A fake that verified any of those would let a ring-2 test prove a tamper is
 * refused while production accepted it — so they are asked of both implementations here,
 * rather than of the real one alone.
 */
export const gallerySignerContract = (name: string, makeSigner: () => GallerySigner): void => {
  describe(`GallerySigner contract: ${name}`, () => {
    const MEDIA = ['media', 'link-1', 'photo-1', 'original', '1782000000000'] as const

    it('verifies exactly what it signed', () => {
      const signer = makeSigner()

      expect(signer.verify(MEDIA, signer.sign(MEDIA))).toBe(true)
    })

    it.each([0, 1, 2, 3, 4])('refuses the statement with field %i changed', (index) => {
      const signer = makeSigner()
      const signature = signer.sign(MEDIA)
      const tampered = MEDIA.map((part, at) => (at === index ? `${part}x` : part))

      expect(signer.verify(tampered, signature)).toBe(false)
    })

    it('refuses a signature when a boundary between two fields is moved', () => {
      // `link-1` + `photo-1` and `link-1p` + `hoto-1` concatenate to the same text; only a
      // canonical encoding of the list tells them apart.
      const signer = makeSigner()
      const signature = signer.sign(['media', 'link-1', 'photo-1'])

      expect(signer.verify(['media', 'link-1p', 'hoto-1'], signature)).toBe(false)
    })

    it('refuses a signature minted for another purpose', () => {
      const signer = makeSigner()
      const unlock = signer.sign(['unlock', 'link-1', '1782000000000'])

      expect(signer.verify(['archive', 'link-1', '1782000000000'], unlock)).toBe(false)
    })

    it('refuses a statement with a field added or dropped', () => {
      const signer = makeSigner()
      const signature = signer.sign(MEDIA)

      expect(signer.verify([...MEDIA, ''], signature)).toBe(false)
      expect(signer.verify(MEDIA.slice(0, 4), signature)).toBe(false)
    })

    it.each([
      ['an empty signature', ''],
      ['a truncated one', 'abc'],
      ['something that is not base64 at all', '%%%%'],
      ['a very long one', 'A'.repeat(4096)],
    ])('answers false, without throwing, for %s', (_label, signature) => {
      const signer = makeSigner()

      expect(signer.verify(MEDIA, signature)).toBe(false)
    })

    it('mints signatures that travel in a URL unescaped', () => {
      const signer = makeSigner()

      expect(signer.sign(MEDIA)).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('mints a different URL-safe token every time, stored as its own digest', () => {
      const signer = makeSigner()

      const first = signer.mintToken()
      const second = signer.mintToken()

      expect(first.token).not.toBe(second.token)
      expect(first.token).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(first.digest).toBe(signer.digestOf(first.token))
      expect(first.digest).not.toBe(second.digest)
      expect(first.digest).toMatch(/^[0-9a-f]{64}$/)
    })

    it('never stores a token as itself', () => {
      const signer = makeSigner()
      const minted = signer.mintToken()

      expect(minted.digest).not.toContain(minted.token)
    })
  })
}
