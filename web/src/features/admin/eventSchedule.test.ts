import { describe, expect, it } from 'vitest'
import { scheduleMoment, toInstant, toLocalInput, upcomingMoves } from './eventSchedule'

/**
 * Ring 5's cheapest half: the conversion the schedule form depends on.
 *
 * Written against the **runner's own zone** rather than against a hardcoded offset. A
 * test that asserted `2026-06-20T18:00` for a given UTC instant would pass in Paris and
 * fail in CI, and pinning `TZ` would only prove the conversion works in one place. What
 * has to hold everywhere is the round trip: what a host sees is what a host typed.
 */

describe('toLocalInput', () => {
  it('renders an instant as the wall-clock time on this machine', () => {
    const at = new Date('2026-06-20T16:00:00.000Z')
    const expected = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(
      at.getDate(),
    ).padStart(2, '0')}T${String(at.getHours()).padStart(2, '0')}:${String(
      at.getMinutes(),
    ).padStart(2, '0')}`

    expect(toLocalInput('2026-06-20T16:00:00.000Z')).toBe(expected)
  })

  it('renders an absent instant as an empty field', () => {
    expect(toLocalInput(null)).toBe('')
  })

  it('renders an unreadable instant as an empty field rather than "Invalid Date"', () => {
    expect(toLocalInput('pas une date')).toBe('')
  })

  it('drops seconds, because the control the host is given offers minutes', () => {
    // Only a direct API call can store an instant with seconds on it. Saving the form
    // afterwards re-sends the truncated one, which is documented rather than fixed.
    expect(toLocalInput('2026-06-20T16:00:45.000Z')).toBe(toLocalInput('2026-06-20T16:00:00.000Z'))
  })

  it('pads a single-digit month, day, hour and minute', () => {
    // The one thing that is genuinely zone-independent to assert: the shape. An input
    // of type datetime-local silently ignores a value that is not exactly this long.
    expect(toLocalInput('2026-01-02T03:04:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })
})

describe('toInstant', () => {
  it('resolves a wall-clock time against this machine, and back again unchanged', () => {
    const typed = '2026-06-20T18:00'

    expect(toLocalInput(toInstant(typed))).toBe(typed)
  })

  it('sends null for an empty field, which is "I will do this one myself"', () => {
    expect(toInstant('')).toBeNull()
  })

  it('sends null for a value the browser could not complete', () => {
    // jsdom renders datetime-local as a text box, so a value no picker would emit can
    // reach this. A `400 request.invalid` for something half-typed would be worse.
    expect(toInstant('le 20 juin')).toBeNull()
  })

  it('produces an instant with an offset, which is what the server accepts', () => {
    expect(toInstant('2026-06-20T18:00')).toMatch(/Z$/)
  })
})

describe('upcomingMoves', () => {
  const armed = {
    scheduledOpenAt: '2026-06-20T16:00:00.000Z',
    scheduledCloseAt: '2026-06-21T00:00:00.000Z',
  }

  it('lists the opening and then the closing of a draft', () => {
    expect(upcomingMoves('draft', armed)).toEqual([
      { kind: 'open', at: armed.scheduledOpenAt },
      { kind: 'close', at: armed.scheduledCloseAt },
    ])
  })

  it('lists only the closing of a live event, whose opening is behind it', () => {
    expect(upcomingMoves('live', armed)).toEqual([{ kind: 'close', at: armed.scheduledCloseAt }])
  })

  it('lists nothing once the evening is over', () => {
    expect(upcomingMoves('closed', armed)).toEqual([])
    expect(upcomingMoves('archived', armed)).toEqual([])
  })

  it('lists nothing for an event with no schedule', () => {
    expect(upcomingMoves('draft', { scheduledOpenAt: null, scheduledCloseAt: null })).toEqual([])
  })
})

describe('scheduleMoment', () => {
  // Built from local fields, so the answer is the same in whichever zone the runner is in.
  const at = new Date(2026, 5, 20, 18, 0)

  it('gives only the time when the instant is today', () => {
    const moment = scheduleMoment(at.toISOString(), new Date(2026, 5, 20, 9, 30), 'fr')

    expect(moment?.today).toBe(true)
    expect(moment?.text).toMatch(/18[:h]00/)
    expect(moment?.text).not.toContain('2026')
  })

  it('gives the date as well when the instant is another day', () => {
    const moment = scheduleMoment(at.toISOString(), new Date(2026, 5, 17, 9, 30), 'fr')

    expect(moment?.today).toBe(false)
    expect(moment?.text).toContain('20')
    expect(moment?.text).toMatch(/18[:h]00/)
  })

  it('shows nothing for a stamp the browser cannot read', () => {
    expect(scheduleMoment('not a date', new Date(), 'fr')).toBeNull()
  })
})
