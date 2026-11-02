import { describe, expect, it } from 'vitest'
import {
  GUESTBOOK_WALL_MAX_MS,
  GUESTBOOK_WALL_MIN_MS,
  GUESTBOOK_WALL_MS_PER_CHARACTER,
  messageDisplayMs,
} from './guestbookWall'

describe('messageDisplayMs', () => {
  it('keeps a very short message up for the minimum', () => {
    expect(messageDisplayMs(0)).toBe(GUESTBOOK_WALL_MIN_MS)
    expect(messageDisplayMs(-5)).toBe(GUESTBOOK_WALL_MIN_MS)
  })

  it('adds the same time for every character', () => {
    expect(messageDisplayMs(10)).toBe(GUESTBOOK_WALL_MIN_MS + 10 * GUESTBOOK_WALL_MS_PER_CHARACTER)
  })

  it('never exceeds the maximum, and reaches it exactly', () => {
    expect(messageDisplayMs(500)).toBe(GUESTBOOK_WALL_MAX_MS)
    const atCeiling =
      (GUESTBOOK_WALL_MAX_MS - GUESTBOOK_WALL_MIN_MS) / GUESTBOOK_WALL_MS_PER_CHARACTER
    expect(messageDisplayMs(atCeiling)).toBe(GUESTBOOK_WALL_MAX_MS)
    expect(messageDisplayMs(atCeiling - 1)).toBeLessThan(GUESTBOOK_WALL_MAX_MS)
  })
})
