import { describe, expect, it } from 'vitest'
import { photoRefusalFor, storageRefusalFor } from './admission'

const EVENT = { quotaBytes: 1_000, usedBytes: 400 }
const CLIENT = { maxBytes: 5_000, usedBytes: 4_900 }

describe('storageRefusalFor', () => {
  it('admits what fits under both ceilings, to the last byte', () => {
    expect(storageRefusalFor(600, EVENT, { maxBytes: 5_000, usedBytes: 4_400 })).toBeNull()
  })

  it('names the event quota, with what it still had room for', () => {
    expect(storageRefusalFor(601, EVENT, null)).toEqual({ reason: 'quotaExceeded', remaining: 600 })
  })

  it('names the client ceiling when only it is reached', () => {
    expect(storageRefusalFor(101, EVENT, CLIENT)).toEqual({
      reason: 'clientStorageFull',
      remaining: 100,
    })
  })

  it('names the event quota first when both are reached', () => {
    expect(storageRefusalFor(700, EVENT, CLIENT)).toEqual({
      reason: 'quotaExceeded',
      remaining: 600,
    })
  })

  it('ignores a client it was not given', () => {
    expect(storageRefusalFor(100, EVENT, null)).toBeNull()
  })

  it('answers nothing left, never a negative, once usage is past the quota', () => {
    expect(storageRefusalFor(1, { quotaBytes: 100, usedBytes: 250 }, null)).toEqual({
      reason: 'quotaExceeded',
      remaining: 0,
    })
  })
})

describe('photoRefusalFor', () => {
  const photo = (heldByAuthor: number | null, byteSize = 100) => ({ byteSize, heldByAuthor })

  it('refuses a guest at the cap, saying how many they hold', () => {
    expect(photoRefusalFor(photo(3), 3, EVENT, null)).toEqual({
      reason: 'photoLimitReached',
      already: 3,
    })
  })

  it('admits a guest one below the cap', () => {
    expect(photoRefusalFor(photo(2), 3, EVENT, null)).toBeNull()
  })

  it('never applies the cap to a host', () => {
    expect(photoRefusalFor(photo(null), 0, EVENT, null)).toBeNull()
  })

  it('has no cap when none is set', () => {
    expect(photoRefusalFor(photo(500), null, EVENT, null)).toBeNull()
  })

  it('names the cap before any byte ceiling', () => {
    expect(photoRefusalFor(photo(3, 9_999), 3, EVENT, CLIENT)).toEqual({
      reason: 'photoLimitReached',
      already: 3,
    })
  })

  it('falls through to the byte ceilings, the event first', () => {
    expect(photoRefusalFor(photo(0, 9_999), 3, EVENT, CLIENT)).toEqual({
      reason: 'quotaExceeded',
      remaining: 600,
    })
  })
})
