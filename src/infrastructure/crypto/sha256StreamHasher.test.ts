import { describe, expect, it } from 'vitest'
import { sha256ContentHasher } from './sha256ContentHasher'
import { sha256StreamHasher } from './sha256StreamHasher'

const bytesOf = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'utf8'))

describe('sha256StreamHasher', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ])('matches the published SHA-256 vector for %p', (input, expected) => {
    const hash = sha256StreamHasher.start()
    hash.update(bytesOf(input))
    expect(hash.digestHex()).toBe(expected)
  })

  it('gives the same digest however the bytes are cut into chunks, and the one-shot hasher agrees', () => {
    const whole = sha256ContentHasher.sha256Hex(bytesOf('a host album, one chunk at a time'))
    const hash = sha256StreamHasher.start()
    hash.update(bytesOf('a host album, '))
    hash.update(bytesOf('one chunk '))
    hash.update(bytesOf('at a time'))
    expect(hash.digestHex()).toBe(whole)
  })
})
