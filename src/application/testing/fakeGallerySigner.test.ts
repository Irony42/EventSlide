import { describe, expect, it } from 'vitest'
import { gallerySignerContract } from './contracts/gallerySignerContract'
import { FakeGallerySigner } from './fakeGallerySigner'

gallerySignerContract('fake', () => new FakeGallerySigner())

describe('FakeGallerySigner', () => {
  it('mints readable tokens in order, so an assertion can name the one a host was handed', () => {
    const signer = new FakeGallerySigner()

    expect(signer.mintToken().token).toBe('token-1')
    expect(signer.mintToken().token).toBe('token-2')
  })
})
