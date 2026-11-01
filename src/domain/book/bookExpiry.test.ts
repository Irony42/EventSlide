import { describe, expect, it } from 'vitest'
import { bookExpiresAt, isBookExpired } from './bookExpiry'

const DONE = new Date('2026-11-01T10:00:00Z')
const day = (n: number): Date => new Date(DONE.getTime() + n * 86_400_000)

describe('bookExpiresAt', () => {
  it('lives the whole ttl when the purge date is null (kept for ever)', () => {
    expect(bookExpiresAt(DONE, 7, null)).toEqual(day(7))
  })
  it('stops at the purge date when it comes first', () => {
    expect(bookExpiresAt(DONE, 7, day(3))).toEqual(day(3))
  })
  it('keeps the ttl when the purge date is later', () => {
    expect(bookExpiresAt(DONE, 7, day(30))).toEqual(day(7))
  })
  it('lives the whole ttl when the purge date is already past, as when the purge is held', () => {
    expect(bookExpiresAt(DONE, 7, day(-2))).toEqual(day(7))
    expect(bookExpiresAt(DONE, 7, DONE)).toEqual(day(7))
  })
})

describe('isBookExpired', () => {
  it('expires at the instant, not after it', () => {
    expect(isBookExpired(day(1), day(1))).toBe(true)
    expect(isBookExpired(day(1), day(0))).toBe(false)
  })
})
