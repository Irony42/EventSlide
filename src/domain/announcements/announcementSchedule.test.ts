import { describe, expect, it } from 'vitest'
import type { AnnouncementKind } from './announcementRules'
import {
  announcementPhaseAt,
  anotherShowing,
  announcementsOverlap,
  nextReadAtMs,
  occupiedSpan,
  visibleAnnouncements,
  type AnnouncementTiming,
} from './announcementSchedule'

const AT = Date.parse('2026-06-20T22:00:00.000Z')
const SECOND = 1000
const MINUTE = 60 * SECOND

const timing = (
  over: Partial<AnnouncementTiming & { id: string }> = {},
): AnnouncementTiming & { id: string } => ({
  id: 'a',
  kind: 'fullscreen',
  at: new Date(AT),
  durationSeconds: 30,
  countdownSeconds: 300,
  ...over,
})

describe('announcementPhaseAt', () => {
  const card = timing()

  it('is upcoming before the countdown starts', () => {
    expect(announcementPhaseAt(card, AT - 300 * SECOND - 1)).toEqual({ phase: 'upcoming' })
  })

  it('counts from at - countdown exactly, with the time left', () => {
    expect(announcementPhaseAt(card, AT - 300 * SECOND)).toEqual({
      phase: 'counting',
      remainingMs: 300 * SECOND,
    })
    expect(announcementPhaseAt(card, AT - 1)).toEqual({ phase: 'counting', remainingMs: 1 })
  })

  it('shows from at exactly, with the time left', () => {
    expect(announcementPhaseAt(card, AT)).toEqual({ phase: 'showing', remainingMs: 30 * SECOND })
    expect(announcementPhaseAt(card, AT + 30 * SECOND - 1)).toEqual({
      phase: 'showing',
      remainingMs: 1,
    })
  })

  it('is over from at + duration exactly', () => {
    expect(announcementPhaseAt(card, AT + 30 * SECOND)).toEqual({ phase: 'over' })
    expect(announcementPhaseAt(card, AT + 10 * 60 * MINUTE)).toEqual({ phase: 'over' })
  })

  it('is never counting without a countdown', () => {
    const launched = timing({ countdownSeconds: 0 })

    expect(announcementPhaseAt(launched, AT - 1)).toEqual({ phase: 'upcoming' })
    expect(announcementPhaseAt(launched, AT).phase).toBe('showing')
  })

  it('goes from upcoming to showing at `at` for a discreet announcement, never counting', () => {
    const discreet = timing({ kind: 'discreet', countdownSeconds: 0, durationSeconds: 900 })

    expect(announcementPhaseAt(discreet, AT - 1)).toEqual({ phase: 'upcoming' })
    expect(announcementPhaseAt(discreet, AT)).toEqual({ phase: 'showing', remainingMs: 900 * SECOND })
    expect(announcementPhaseAt(discreet, AT + 900 * SECOND - 1).phase).toBe('showing')
    expect(announcementPhaseAt(discreet, AT + 900 * SECOND)).toEqual({ phase: 'over' })
  })
})

describe('visibleAnnouncements', () => {
  const card = timing({ id: 'cake' })

  it('serves nothing 61 seconds before the window opens', () => {
    const now = AT - 300 * SECOND - 61 * SECOND

    expect(visibleAnnouncements([card], now)).toEqual([])
  })

  it('serves the text from 60 seconds before the countdown starts', () => {
    const now = AT - 300 * SECOND - 60 * SECOND

    expect(visibleAnnouncements([card], now)).toEqual([card])
  })

  it('uses the countdown of each announcement to open its window', () => {
    const launched = timing({ id: 'now', countdownSeconds: 0 })

    expect(visibleAnnouncements([launched], AT - 61 * SECOND)).toEqual([])
    expect(visibleAnnouncements([launched], AT - 60 * SECOND)).toEqual([launched])
  })

  it('keeps serving until the end, which is already over', () => {
    expect(visibleAnnouncements([card], AT + 30 * SECOND - 1)).toEqual([card])
    expect(visibleAnnouncements([card], AT + 30 * SECOND)).toEqual([])
  })

  it('serves a discreet announcement for its whole length', () => {
    const discreet = timing({ id: 'buffet', kind: 'discreet', countdownSeconds: 0, durationSeconds: 1800 })

    expect(visibleAnnouncements([discreet], AT + 29 * MINUTE)).toEqual([discreet])
  })

  it('lists by time, then by id, whatever order the rows came in', () => {
    const later = timing({ id: 'a', at: new Date(AT + MINUTE) })
    const sameB = timing({ id: 'b' })
    const sameA = timing({ id: 'c' })

    expect(visibleAnnouncements([later, sameA, sameB], AT).map((row) => row.id)).toEqual([
      'b',
      'c',
      'a',
    ])
  })

  it('orders ids both ways', () => {
    const first = timing({ id: 'a' })
    const second = timing({ id: 'b' })

    expect(visibleAnnouncements([first, second], AT).map((row) => row.id)).toEqual(['a', 'b'])
    expect(visibleAnnouncements([second, first], AT).map((row) => row.id)).toEqual(['a', 'b'])
  })
})

describe('nextReadAtMs', () => {
  it('is null with no announcement', () => {
    expect(nextReadAtMs([], AT)).toBeNull()
  })

  it('is null when every announcement is over', () => {
    expect(nextReadAtMs([timing()], AT + 30 * SECOND)).toBeNull()
  })

  it('is capped at fifteen minutes from now, so it never says when the next one is', () => {
    const farAway = timing({ at: new Date(AT + 3 * 60 * MINUTE) })

    expect(nextReadAtMs([farAway], AT)).toBe(AT + 15 * MINUTE)
  })

  it('is thirty seconds before the first apparition when that comes sooner', () => {
    const now = AT - 300 * SECOND - 10 * MINUTE

    expect(nextReadAtMs([timing()], now)).toBe(AT - 300 * SECOND - 30 * SECOND)
  })

  it('takes the soonest of several announcements', () => {
    const early = timing({ at: new Date(AT + 20 * MINUTE) })
    const late = timing({ at: new Date(AT + 2 * 60 * MINUTE) })
    const now = AT + 20 * MINUTE - 300 * SECOND - 3 * MINUTE

    expect(nextReadAtMs([late, early], now)).toBe(AT + 20 * MINUTE - 300 * SECOND - 30 * SECOND)
  })

  it('is the cap while the text is already served and the announcement has not finished', () => {
    const now = AT - 60 * SECOND

    expect(nextReadAtMs([timing()], now)).toBe(now + 15 * MINUTE)
  })

  it('counts an announcement on screen as pending', () => {
    expect(nextReadAtMs([timing()], AT + 5 * SECOND)).toBe(AT + 5 * SECOND + 15 * MINUTE)
  })

  it('is never in the past: a text window that has not opened yet opens after now', () => {
    // 40 s before the window opens: the read is at the apparition less 30 s, which is later than now.
    const now = AT - 300 * SECOND - 60 * SECOND - 40 * SECOND
    const next = nextReadAtMs([timing()], now)

    expect(next).not.toBeNull()
    expect(next as number).toBeGreaterThan(now)
  })
})

describe('occupiedSpan and announcementsOverlap', () => {
  const at = (offsetSeconds: number, kind: AnnouncementKind, durationSeconds: number) =>
    timing({
      kind,
      at: new Date(AT + offsetSeconds * SECOND),
      durationSeconds,
      countdownSeconds: 0,
    })

  it('holds a fullscreen card for its duration and a discreet one a minute longer', () => {
    expect(occupiedSpan(at(0, 'fullscreen', 30))).toEqual({ fromMs: AT, toMs: AT + 30 * SECOND })
    expect(occupiedSpan(at(0, 'discreet', 300))).toEqual({
      fromMs: AT,
      toMs: AT + 300 * SECOND + 60 * SECOND,
    })
  })

  it('refuses two fullscreen cards that overlap, and lets one start as the other ends', () => {
    const first = at(0, 'fullscreen', 30)

    expect(announcementsOverlap(first, at(29, 'fullscreen', 30))).toBe(true)
    expect(announcementsOverlap(first, at(30, 'fullscreen', 30))).toBe(false)
    expect(announcementsOverlap(at(30, 'fullscreen', 30), first)).toBe(false)
  })

  it('does not look at the countdown: banners may overlap', () => {
    const first = timing({ countdownSeconds: 900 })
    const second = timing({ at: new Date(AT + 30 * SECOND), countdownSeconds: 900 })

    expect(announcementsOverlap(first, second)).toBe(false)
  })

  it('refuses two discreet announcements 59 seconds apart and accepts them 60 apart', () => {
    const first = at(0, 'discreet', 300)

    expect(announcementsOverlap(first, at(300 + 59, 'discreet', 300))).toBe(true)
    expect(announcementsOverlap(first, at(300 + 60, 'discreet', 300))).toBe(false)
    expect(announcementsOverlap(at(300 + 59, 'discreet', 300), first)).toBe(true)
  })

  it('lets a fullscreen card and a discreet announcement overlap: they are two layers', () => {
    expect(announcementsOverlap(at(0, 'discreet', 900), at(60, 'fullscreen', 30))).toBe(false)
    expect(announcementsOverlap(at(60, 'fullscreen', 30), at(0, 'discreet', 900))).toBe(false)
  })
})

describe('anotherShowing', () => {
  const onScreen = timing({ id: 'on', countdownSeconds: 0, durationSeconds: 30 })

  it('sees a card of the same kind on screen', () => {
    expect(anotherShowing([onScreen], 'fullscreen', AT + 5 * SECOND, null)).toBe(true)
  })

  it('does not see one that is over, or has not started', () => {
    expect(anotherShowing([onScreen], 'fullscreen', AT + 30 * SECOND, null)).toBe(false)
    expect(anotherShowing([onScreen], 'fullscreen', AT - 1, null)).toBe(false)
  })

  it('does not count a card of the other kind: they are two layers', () => {
    expect(anotherShowing([onScreen], 'discreet', AT + 5 * SECOND, null)).toBe(false)
  })

  it('leaves out the announcement itself', () => {
    expect(anotherShowing([onScreen], 'fullscreen', AT + 5 * SECOND, 'on')).toBe(false)
  })
})
