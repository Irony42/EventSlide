import { describe, expect, it } from 'vitest'
import { NOTICE_KINDS } from './noticeKind'
import { freshUntil, isFresh } from './noticeFreshness'

const TRIGGER = new Date('2026-12-13T10:00:00.000Z')
const after = (ms: number): Date => new Date(TRIGGER.getTime() + ms)
const HOUR = 60 * 60 * 1000

describe('isFresh', () => {
  it.each([
    ['rsvpErasure', 0],
    ['rsvpDeadline', 0],
    ['rsvpFull', 0],
    ['windowEnding', 0],
    ['rsvpStopped', 24 * HOUR],
    ['jobDone', 24 * HOUR],
    ['eventClosed', 48 * HOUR],
  ] as const)('%s is fresh until %i ms after its trigger, and not at that instant', (kind, ms) => {
    expect(freshUntil(kind, TRIGGER).getTime()).toBe(after(ms).getTime())
    expect(isFresh(kind, TRIGGER, after(ms - 1))).toBe(true)
    expect(isFresh(kind, TRIGGER, after(ms))).toBe(false)
    expect(isFresh(kind, TRIGGER, after(ms + 1))).toBe(false)
  })

  it('has an answer for every kind of notice', () => {
    for (const kind of NOTICE_KINDS) {
      expect(Number.isNaN(freshUntil(kind, TRIGGER).getTime())).toBe(false)
    }
  })

  it('never sends the notice of a date months gone: a box updated late finds everything stale', () => {
    const longAfter = after(90 * 24 * HOUR)
    for (const kind of NOTICE_KINDS) expect(isFresh(kind, TRIGGER, longAfter)).toBe(false)
  })
})
