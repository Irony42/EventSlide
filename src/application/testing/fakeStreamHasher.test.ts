import { describe, expect, it } from 'vitest'
import { FakeContentHasher } from './fakeContentHasher'
import { FakeStreamHasher } from './fakeStreamHasher'

describe('FakeStreamHasher', () => {
  it('digests chunks as the content hasher digests the bytes put end to end', () => {
    const hash = new FakeStreamHasher().start()
    hash.update(Uint8Array.from([1, 2]))
    hash.update(Uint8Array.from([3]))

    expect(hash.digestHex()).toBe(new FakeContentHasher().sha256Hex(Uint8Array.from([1, 2, 3])))
  })
})
