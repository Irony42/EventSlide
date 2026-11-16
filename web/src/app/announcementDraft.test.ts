import { describe, expect, it } from 'vitest'
import { anAnnouncement } from '../testing/renderWithProviders'
import {
  KIND_OFFERS,
  blankDraft,
  draftOf,
  editInput,
  hasText,
  launchInput,
  scheduleInput,
  withKind,
} from './announcementDraft'

describe('what the form offers for each kind', () => {
  it('offers a card 15, 30 and 60 seconds with a countdown of none, 1, 5, 10 or 15 minutes', () => {
    expect(KIND_OFFERS.fullscreen.durations).toEqual([15, 30, 60])
    expect(KIND_OFFERS.fullscreen.defaultDuration).toBe(30)
    expect(KIND_OFFERS.fullscreen.countdowns).toEqual([0, 60, 300, 600, 900])
    expect(KIND_OFFERS.fullscreen.defaultCountdown).toBe(300)
  })

  it('offers a discreet text 5, 10, 15 and 30 minutes, and no countdown at all', () => {
    expect(KIND_OFFERS.discreet.durations).toEqual([300, 600, 900, 1800])
    expect(KIND_OFFERS.discreet.defaultDuration).toBe(900)
    expect(KIND_OFFERS.discreet.countdowns).toBeNull()
  })

  it('never offers a step the server would refuse for its kind', () => {
    // The domain's bounds: 10 to 120 s for a card, 300 to 1800 s for a discreet text.
    for (const seconds of KIND_OFFERS.fullscreen.durations) {
      expect(seconds).toBeGreaterThanOrEqual(10)
      expect(seconds).toBeLessThanOrEqual(120)
    }
    for (const seconds of KIND_OFFERS.discreet.durations) {
      expect(seconds).toBeGreaterThanOrEqual(300)
      expect(seconds).toBeLessThanOrEqual(1800)
    }
  })
})

describe('withKind', () => {
  it('puts the new kind’s default duration back when the kind changes', () => {
    const long = { ...blankDraft(), durationSeconds: 60 }

    expect(withKind(long, 'discreet').durationSeconds).toBe(900)
    expect(
      withKind({ ...blankDraft('discreet'), durationSeconds: 1800 }, 'fullscreen'),
    ).toMatchObject({ durationSeconds: 30, countdownSeconds: 300 })
  })

  it('keeps the draft as it is when the same kind is picked again', () => {
    const chosen = { ...blankDraft(), durationSeconds: 60 }

    expect(withKind(chosen, 'fullscreen')).toBe(chosen)
  })

  it('keeps what was typed', () => {
    const typed = { ...blankDraft(), text: 'Le gâteau', time: '22:00' }

    expect(withKind(typed, 'discreet')).toMatchObject({ text: 'Le gâteau', time: '22:00' })
  })
})

describe('what is sent', () => {
  const draft = { ...blankDraft(), text: '  Le gâteau arrive ', time: '22:00' }

  it('schedules a card with its countdown', () => {
    expect(scheduleInput(draft, Date.UTC(2026, 5, 20, 20, 0))).toEqual({
      text: 'Le gâteau arrive',
      kind: 'fullscreen',
      at: '2026-06-20T20:00:00.000Z',
      durationSeconds: 30,
      countdownSeconds: 300,
    })
  })

  it('schedules a discreet text with no countdown field at all', () => {
    const sent = scheduleInput(withKind(draft, 'discreet'), Date.UTC(2026, 5, 20, 20, 0))

    expect(sent).toEqual({
      text: 'Le gâteau arrive',
      kind: 'discreet',
      at: '2026-06-20T20:00:00.000Z',
      durationSeconds: 900,
    })
    expect(sent).not.toHaveProperty('countdownSeconds')
  })

  it('launches with no moment and no countdown, which is what makes it a launch', () => {
    const sent = launchInput(draft)

    expect(sent).toEqual({ text: 'Le gâteau arrive', kind: 'fullscreen', durationSeconds: 30 })
    expect(sent).not.toHaveProperty('at')
    expect(sent).not.toHaveProperty('countdownSeconds')
  })

  it('saves a discreet text on screen with its text alone', () => {
    expect(editInput({ ...draft, text: 'Le buffet est ouvert' }, true, 123)).toEqual({
      text: 'Le buffet est ouvert',
    })
  })

  it('saves every field otherwise, and the moment only when it was changed', () => {
    const untouched = editInput(draft, false, null)

    expect(untouched).toEqual({
      text: 'Le gâteau arrive',
      kind: 'fullscreen',
      durationSeconds: 30,
      countdownSeconds: 300,
    })
    expect(untouched).not.toHaveProperty('at')
    expect(editInput(draft, false, Date.UTC(2026, 5, 20, 20, 0))).toMatchObject({
      at: '2026-06-20T20:00:00.000Z',
    })
  })

  it('sends no countdown for a discreet text it saves', () => {
    expect(editInput(withKind(draft, 'discreet'), false, null).countdownSeconds).toBe(0)
  })
})

describe('hasText and draftOf', () => {
  it('needs something written, not blanks', () => {
    expect(hasText(blankDraft())).toBe(false)
    expect(hasText({ ...blankDraft(), text: '   ' })).toBe(false)
    expect(hasText({ ...blankDraft(), text: 'Gâteau' })).toBe(true)
  })

  it('reads a row back into the form, the time in the browser’s own zone', () => {
    const at = new Date(2026, 5, 20, 22, 15).toISOString()

    expect(
      draftOf(anAnnouncement({ at, kind: 'discreet', durationSeconds: 600, countdownSeconds: 0 })),
    ).toEqual({
      text: 'Le gâteau arrive',
      time: '22:15',
      kind: 'discreet',
      countdownSeconds: 0,
      durationSeconds: 600,
    })
  })
})
