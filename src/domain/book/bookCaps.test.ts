import { describe, expect, it } from 'vitest'
import {
  BOOK_WINDOW_MS,
  bookWindowStart,
  checkBookBytes,
  checkBookDailyLimit,
  bookRetryAfterSeconds,
  checkBookSize,
} from './bookCaps'

const code = (r: { ok: boolean; error?: { code: string } }): string | null =>
  r.ok ? null : (r.error?.code ?? null)

describe('book size', () => {
  it('refuses an empty book', () => {
    expect(code(checkBookSize(0, 300))).toBe('book.empty')
  })
  it('allows 299 and exactly 300, refuses 301 and names the ceiling', () => {
    expect(code(checkBookSize(299, 300))).toBeNull()
    expect(code(checkBookSize(300, 300))).toBeNull()
    const refused = checkBookSize(301, 300)
    expect(code(refused)).toBe('book.tooLarge')
    expect(!refused.ok && refused.error.details).toEqual({ max: 300 })
  })
  it('allows one photograph', () => {
    expect(code(checkBookSize(1, 300))).toBeNull()
  })
})

describe('book bytes', () => {
  it('allows exactly the ceiling and refuses one byte more', () => {
    expect(code(checkBookBytes(1_000, 1_000))).toBeNull()
    expect(code(checkBookBytes(1_001, 1_000))).toBe('book.tooLarge')
  })
})

describe('book daily limit', () => {
  it('allows the third request of a day and refuses the fourth', () => {
    expect(code(checkBookDailyLimit(2, 3, 60))).toBeNull()
    expect(code(checkBookDailyLimit(3, 3, 60))).toBe('book.dailyLimitReached')
    expect(code(checkBookDailyLimit(4, 3, 60))).toBe('book.dailyLimitReached')
  })
  it('tells a refused host how long to wait', () => {
    const refused = checkBookDailyLimit(3, 3, 90)
    expect(!refused.ok && refused.error.details).toEqual({ max: 3, retryAfterSeconds: 90 })
  })
  it('waits until the oldest request leaves the window, and never less than a second', () => {
    const oldest = new Date('2026-11-01T10:00:00Z')
    const later = new Date('2026-11-01T22:00:00Z')
    expect(bookRetryAfterSeconds(oldest, later)).toBe(12 * 3600)
    expect(bookRetryAfterSeconds(oldest, new Date('2026-11-02T10:00:00.500Z'))).toBe(1)
    expect(bookRetryAfterSeconds(oldest, new Date('2026-11-05T10:00:00Z'))).toBe(1)
  })
  it('counts a rolling day back from now', () => {
    const now = new Date('2026-11-02T12:00:00Z')
    expect(bookWindowStart(now).getTime()).toBe(now.getTime() - BOOK_WINDOW_MS)
    expect(BOOK_WINDOW_MS).toBe(86_400_000)
  })
})
