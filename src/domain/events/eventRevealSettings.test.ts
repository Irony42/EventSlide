import { describe, expect, it } from 'vitest'
import { PHOTO_STATUSES } from '../photos/photoStatus'
import {
  DEFAULT_REVEAL_SETTINGS,
  isRevealed,
  mergeRevealSettings,
  restoreRevealSettings,
  revealChangeViolation,
  revealNow,
  revealSettingsViolation,
  visibleStatuses,
  type EventRevealSettings,
} from './eventRevealSettings'
import { EventSettings } from './eventSettings'

const NOW = new Date('2026-11-20T21:00:00.000Z')
const minutes = (n: number): Date => new Date(NOW.getTime() + n * 60_000)

const on = (at: Date | null, film = false): EventRevealSettings => ({ enabled: true, at, film })

describe('isRevealed (spec 23 rule 1)', () => {
  it('is revealed when the mode is off, whatever the hour says', () => {
    expect(isRevealed(DEFAULT_REVEAL_SETTINGS, NOW)).toBe(true)
    expect(isRevealed({ enabled: false, at: minutes(60), film: false }, NOW)).toBe(true)
  })

  it('is not revealed with the mode on and no hour: the host decides with the button', () => {
    expect(isRevealed(on(null), NOW)).toBe(false)
  })

  it('is not revealed before the hour', () => {
    expect(isRevealed(on(minutes(1)), NOW)).toBe(false)
  })

  it('is revealed at the exact instant: the hour is inclusive', () => {
    expect(isRevealed(on(new Date(NOW.getTime())), NOW)).toBe(true)
  })

  it('is revealed after the hour', () => {
    expect(isRevealed(on(minutes(-1)), NOW)).toBe(true)
  })
})

describe('visibleStatuses (spec 23 rule 7)', () => {
  it('is empty before the reveal: the public reads no status at all', () => {
    expect(visibleStatuses(on(minutes(30)), NOW)).toEqual([])
  })

  it('is exactly published once revealed, never a status that had no decision', () => {
    expect(visibleStatuses(on(minutes(-30)), NOW)).toEqual(['published'])
    expect(visibleStatuses(DEFAULT_REVEAL_SETTINGS, NOW)).toEqual(['published'])
    for (const status of PHOTO_STATUSES.filter((s) => s !== 'published')) {
      expect(visibleStatuses(DEFAULT_REVEAL_SETTINGS, NOW)).not.toContain(status)
    }
  })
})

describe('mergeRevealSettings: field by field', () => {
  it('keeps the hour when a patch names only the film look', () => {
    const base = on(minutes(30))
    expect(mergeRevealSettings(base, { film: true })).toEqual({ ...base, film: true })
  })

  it('clears the hour with an explicit null, and leaves it alone when absent', () => {
    const base = on(minutes(30), true)
    expect(mergeRevealSettings(base, { at: null }).at).toBeNull()
    expect(mergeRevealSettings(base, {}).at).toBe(base.at)
    expect(mergeRevealSettings(base, undefined)).toEqual(base)
  })

  it('merges through the settings without touching the rest of the policy', () => {
    const first = EventSettings.create({ moderation: 'auto', reveal: { enabled: true } })
    if (!first.ok) throw new Error('expected ok')
    const second = first.value.with({ reveal: { film: true } })
    if (!second.ok) throw new Error('expected ok')

    expect(second.value.reveal).toEqual({ enabled: true, at: null, film: true })
    expect(second.value.moderation).toBe('auto')
  })

  it('defaults an event to the mode being off', () => {
    expect(EventSettings.default().reveal).toEqual({ enabled: false, at: null, film: false })
  })
})

describe('revealSettingsViolation: a real instant', () => {
  it('refuses an invalid date', () => {
    const settings = EventSettings.create({ reveal: { at: new Date('nope') } })
    expect(!settings.ok && settings.error.code).toBe('eventSettings.revealInstantInvalid')
    expect(revealSettingsViolation(on(new Date(Number.NaN)))?.code).toBe(
      'eventSettings.revealInstantInvalid',
    )
  })

  it('accepts no hour and a valid one', () => {
    expect(revealSettingsViolation(on(null))).toBeNull()
    expect(revealSettingsViolation(on(minutes(5)))).toBeNull()
  })
})

describe('revealChangeViolation (spec 23 rules 3 and 4)', () => {
  it('refuses an hour that has already gone by when the host names it', () => {
    expect(revealChangeViolation(on(null), on(minutes(-1)), NOW)?.code).toBe(
      'eventSettings.revealInPast',
    )
    expect(revealChangeViolation(on(null), on(new Date(NOW.getTime())), NOW)?.code).toBe(
      'eventSettings.revealInPast',
    )
  })

  it('accepts a future hour, and clearing an hour that has not come', () => {
    expect(revealChangeViolation(on(null), on(minutes(1)), NOW)).toBeNull()
    expect(revealChangeViolation(on(minutes(10)), on(minutes(90)), NOW)).toBeNull()
    expect(revealChangeViolation(on(minutes(10)), on(null), NOW)).toBeNull()
  })

  it('refuses to move a reveal that is done into the future: one way', () => {
    expect(revealChangeViolation(on(minutes(-5)), on(minutes(30)), NOW)?.code).toBe(
      'eventSettings.revealDone',
    )
    expect(revealChangeViolation(on(minutes(-5)), on(null), NOW)?.code).toBe(
      'eventSettings.revealDone',
    )
  })

  it('refuses to move a reveal that is done to another past hour as well', () => {
    expect(revealChangeViolation(on(minutes(-5)), on(minutes(-2)), NOW)?.code).toBe(
      'eventSettings.revealInPast',
    )
  })

  it('lets the host switch the mode off after the reveal: the photographs are visible anyway', () => {
    const before = on(minutes(-5))
    expect(revealChangeViolation(before, { ...before, enabled: false }, NOW)).toBeNull()
  })

  it('accepts the same form sent back with the hour it already holds, even a past one', () => {
    const before = on(minutes(-5))
    expect(revealChangeViolation(before, { ...before, film: true }, NOW)).toBeNull()
    expect(
      revealChangeViolation(
        before,
        mergeRevealSettings(before, { at: new Date(before.at!.getTime()) }),
        NOW,
      ),
    ).toBeNull()
  })
})

describe('revealNow: "Révéler maintenant" is an hour that is now', () => {
  it('writes at = now and keeps the rest', () => {
    const result = revealNow(on(minutes(120), true), NOW)
    expect(result.at?.getTime()).toBe(NOW.getTime())
    expect(result).toMatchObject({ enabled: true, film: true })
    expect(isRevealed(result, NOW)).toBe(true)
  })

  it('never aliases the caller’s clock value', () => {
    const now = new Date(NOW.getTime())
    const result = revealNow(on(null), now)
    now.setTime(0)
    expect(result.at?.getTime()).toBe(NOW.getTime())
  })
})

describe('restoreRevealSettings: what the column holds', () => {
  it('reads an absent key as off: a read, not a migration', () => {
    expect(restoreRevealSettings(undefined)).toEqual(DEFAULT_REVEAL_SETTINGS)
  })

  it('reads the stored shape back, the hour as an instant', () => {
    const at = '2026-11-20T22:00:00.000Z'
    expect(restoreRevealSettings({ enabled: true, at, film: true })).toEqual({
      enabled: true,
      at: new Date(at),
      film: true,
    })
    expect(restoreRevealSettings({ enabled: true, at: null, film: false })).toEqual(on(null))
  })

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'on'],
    ['a missing flag', { enabled: true, at: null }],
    ['a non-boolean flag', { enabled: 'yes', at: null, film: false }],
    ['an hour that is not text', { enabled: true, at: 1_800_000_000_000, film: false }],
    ['an hour that is not a date', { enabled: true, at: 'soon', film: false }],
  ])('refuses %s, so a gate is never read as open by accident', (_name, raw) => {
    expect(restoreRevealSettings(raw)).toBeNull()
  })
})
