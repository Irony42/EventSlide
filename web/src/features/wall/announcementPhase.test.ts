import { describe, expect, it } from 'vitest'
import { aWallAnnouncement } from '../../testing/renderWithProviders'
import { wallAnnouncementPhaseAt } from './announcementPhase'

/**
 * The browser's copy of the phase rule (spec 21, rule 5). The domain's own tests pin the rule; the
 * contract test pins that this is the same text. What is left to prove here is the one thing the
 * copy adds: the instant arrives as an ISO string and is read in milliseconds.
 */
const AT = Date.parse('2026-11-16T21:00:00.000Z')
const announcement = aWallAnnouncement(AT, { countdownSeconds: 300, durationSeconds: 30 })

describe('the phase of a wall announcement', () => {
  it('is upcoming until the countdown starts, and counting from that exact millisecond', () => {
    expect(wallAnnouncementPhaseAt(announcement, AT - 300_001)).toEqual({ phase: 'upcoming' })
    expect(wallAnnouncementPhaseAt(announcement, AT - 300_000)).toEqual({
      phase: 'counting',
      remainingMs: 300_000,
    })
  })

  it('is showing from `at` itself, with the time left, and over at `at + duration`', () => {
    expect(wallAnnouncementPhaseAt(announcement, AT - 1)).toEqual({
      phase: 'counting',
      remainingMs: 1,
    })
    expect(wallAnnouncementPhaseAt(announcement, AT)).toEqual({
      phase: 'showing',
      remainingMs: 30_000,
    })
    expect(wallAnnouncementPhaseAt(announcement, AT + 29_999)).toEqual({
      phase: 'showing',
      remainingMs: 1,
    })
    expect(wallAnnouncementPhaseAt(announcement, AT + 30_000)).toEqual({ phase: 'over' })
  })

  it('never counts down without a countdown', () => {
    const launched = aWallAnnouncement(AT, { countdownSeconds: 0 })

    expect(wallAnnouncementPhaseAt(launched, AT - 1)).toEqual({ phase: 'upcoming' })
    expect(wallAnnouncementPhaseAt(launched, AT).phase).toBe('showing')
  })
})
