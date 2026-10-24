import { describe, expect, it } from 'vitest'
import { ContentHash } from '../../domain/photos/contentHash'
import { FakeContentHasher } from './fakeContentHasher'

describe('FakeContentHasher', () => {
  const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)

  it('hashes the same bytes to the same digest, which is what makes ingest idempotent', () => {
    const hasher = new FakeContentHasher()

    expect(hasher.sha256Hex(bytes(1, 2, 3))).toBe(hasher.sha256Hex(bytes(1, 2, 3)))
  })

  it('hashes different bytes to different digests', () => {
    const hasher = new FakeContentHasher()

    expect(hasher.sha256Hex(bytes(1, 2, 3))).not.toBe(hasher.sha256Hex(bytes(3, 2, 1)))
    expect(hasher.sha256Hex(bytes())).not.toBe(hasher.sha256Hex(bytes(0)))
  })

  it('answers something the domain accepts as a content hash', () => {
    const digest = new FakeContentHasher().sha256Hex(bytes(9, 9, 9))

    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    expect(ContentHash.create(digest).ok).toBe(true)
  })

  it('can be broken, answering a string no content hash accepts', () => {
    const digest = new FakeContentHasher().returnGarbage().sha256Hex(bytes(1))

    expect(ContentHash.create(digest).ok).toBe(false)
  })
})
