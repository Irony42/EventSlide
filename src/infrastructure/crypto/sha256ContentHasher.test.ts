import { describe, expect, it } from 'vitest'
import { sha256ContentHasher } from './sha256ContentHasher'

/**
 * Ring 3, against the real `node:crypto`.
 *
 * This digest is what makes stored media content-addressed and a retried upload
 * idempotent, so the two properties that matter are stability for identical bytes and
 * a completely different digest for a one-bit change. The known-answer vectors are
 * there because "stable and different" would also pass for a hash that is not SHA-256
 * at all, and the stored paths are on disk for the life of the installation.
 */

const bytesOf = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'utf8'))

describe('sha256ContentHasher', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ])(
    'matches the published SHA-256 vector for %p, so stored media paths stay valid across versions',
    (input, expected) => {
      expect(sha256ContentHasher.sha256Hex(bytesOf(input))).toBe(expected)
    },
  )

  it('returns the same digest for two separate buffers holding identical bytes, which is what makes a retried upload idempotent', () => {
    const first = bytesOf('rendered display bytes')
    const second = bytesOf('rendered display bytes')

    expect(sha256ContentHasher.sha256Hex(first)).toBe(sha256ContentHasher.sha256Hex(second))
  })

  it('returns a different digest when a single bit changes, so two photos cannot share a content address', () => {
    const original = bytesOf('rendered display bytes')
    const flipped = Uint8Array.from(original, (byte, index) =>
      index === 0 ? byte ^ 0b0000_0001 : byte,
    )

    expect(sha256ContentHasher.sha256Hex(flipped)).not.toBe(sha256ContentHasher.sha256Hex(original))
  })

  it('returns lowercase hexadecimal, because the digest becomes a path on a case-insensitive filesystem', () => {
    expect(sha256ContentHasher.sha256Hex(bytesOf('rendered display bytes'))).toMatch(
      /^[0-9a-f]{64}$/,
    )
  })

  it('hashes the bytes it is given and not their text meaning, so a JPEG and its EXIF-stripped copy differ', () => {
    const withMarker = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x01])
    const withoutMarker = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00])

    expect(sha256ContentHasher.sha256Hex(withMarker)).not.toBe(
      sha256ContentHasher.sha256Hex(withoutMarker),
    )
  })
})
