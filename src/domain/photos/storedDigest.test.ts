import { describe, expect, it } from 'vitest'
import { digestVouchesForVariant } from './storedDigest'

/**
 * A row's digest is the SHA-256 of one rendition's bytes, and which one depends on the kind:
 * the display rendition of a photograph, each of a clip's two files. The export checks a file
 * against it only where it can.
 */

describe('digestVouchesForVariant', () => {
  it('vouches for a photograph display rendition, the bytes its digest was taken over', () => {
    expect(digestVouchesForVariant('photo', 'display')).toBe(true)
  })

  it('does not vouch for a photograph original or thumbnail, stored under the name of another rendition', () => {
    expect(digestVouchesForVariant('photo', 'original')).toBe(false)
    expect(digestVouchesForVariant('photo', 'thumb')).toBe(false)
  })

  it('vouches for both files of a clip', () => {
    expect(digestVouchesForVariant('clip', 'video')).toBe(true)
    expect(digestVouchesForVariant('clip', 'poster')).toBe(true)
  })
})
