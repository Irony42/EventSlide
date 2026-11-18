import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GUESTBOOK_VOICE_SETTINGS,
  isVoiceOpen,
  mergeGuestbookVoiceSettings,
  restoreGuestbookVoiceSettings,
  voiceOpensAtViolation,
  voiceSettingsViolation,
  type EventGuestbookVoiceSettings,
} from './eventGuestbookVoiceSettings'
import { EventSettings } from './eventSettings'
import { EVENT_STATUSES } from './eventStatus'

const NOW = new Date('2026-06-20T22:00:00.000Z')
const NOW_MS = NOW.getTime()

const settings = (
  overrides: Partial<EventGuestbookVoiceSettings> = {},
): EventGuestbookVoiceSettings => ({ enabled: true, sealed: false, opensAtMs: null, ...overrides })

describe('the defaults', () => {
  it('are off, not sealed and with no opening time, for an event nobody consulted', () => {
    expect(DEFAULT_GUESTBOOK_VOICE_SETTINGS).toEqual({
      enabled: false,
      sealed: false,
      opensAtMs: null,
    })
    expect(EventSettings.default().guestbookVoice).toEqual(DEFAULT_GUESTBOOK_VOICE_SETTINGS)
  })
})

describe('mergeGuestbookVoiceSettings', () => {
  it('keeps what a patch does not name: a patch of `sealed` alone keeps `opensAtMs`', () => {
    const merged = mergeGuestbookVoiceSettings(
      settings({ sealed: false, opensAtMs: 1_800_000_000_000 }),
      { sealed: true },
    )

    expect(merged).toEqual({ enabled: true, sealed: true, opensAtMs: 1_800_000_000_000 })
  })

  it('keeps `enabled` through a patch that only opens the book now', () => {
    const merged = mergeGuestbookVoiceSettings(settings({ sealed: true }), { opensAtMs: NOW_MS })

    expect(merged).toEqual({ enabled: true, sealed: true, opensAtMs: NOW_MS })
  })

  it('takes null as a value: clearing an opening time is not "leave it alone"', () => {
    const merged = mergeGuestbookVoiceSettings(settings({ opensAtMs: 5 }), { opensAtMs: null })

    expect(merged.opensAtMs).toBeNull()
  })

  it('takes false as a value, and treats a missing patch as nothing to change', () => {
    expect(
      mergeGuestbookVoiceSettings(settings({ enabled: true }), { enabled: false }).enabled,
    ).toBe(false)
    expect(mergeGuestbookVoiceSettings(settings({ sealed: true }), undefined)).toEqual(
      settings({ sealed: true }),
    )
  })

  it('is what an event’s settings do with a patch, field by field', () => {
    const base = EventSettings.default().with({
      guestbookVoice: { enabled: true, sealed: true, opensAtMs: 1_800_000_000_000 },
    })
    if (!base.ok) throw new Error('fixture')

    const updated = base.value.with({ guestbookVoice: { sealed: false } })

    expect(updated.ok && updated.value.guestbookVoice).toEqual({
      enabled: true,
      sealed: false,
      opensAtMs: 1_800_000_000_000,
    })
  })

  it('is left alone by a patch of other settings', () => {
    const base = EventSettings.default().with({ guestbookVoice: { enabled: true } })
    if (!base.ok) throw new Error('fixture')

    const updated = base.value.with({ allowReactions: false })

    expect(updated.ok && updated.value.guestbookVoice.enabled).toBe(true)
  })
})

describe('isVoiceOpen', () => {
  it('is open when the book is not sealed', () => {
    expect(isVoiceOpen(settings({ sealed: false }), { status: 'live' }, NOW)).toBe(true)
  })

  it('is closed when the book is sealed, live, and has no opening time', () => {
    expect(isVoiceOpen(settings({ sealed: true }), { status: 'live' }, NOW)).toBe(false)
  })

  it('is closed while the opening time is still to come', () => {
    expect(
      isVoiceOpen(settings({ sealed: true, opensAtMs: NOW_MS + 1 }), { status: 'live' }, NOW),
    ).toBe(false)
  })

  it('opens exactly at the opening time: the instant itself is included', () => {
    expect(
      isVoiceOpen(settings({ sealed: true, opensAtMs: NOW_MS }), { status: 'live' }, NOW),
    ).toBe(true)
    expect(
      isVoiceOpen(settings({ sealed: true, opensAtMs: NOW_MS - 1 }), { status: 'live' }, NOW),
    ).toBe(true)
  })

  it.each(EVENT_STATUSES.filter((status) => status !== 'live'))(
    'opens by itself when the party is over (%s), with nothing written at closing',
    (status) => {
      expect(isVoiceOpen(settings({ sealed: true }), { status }, NOW)).toBe(true)
    },
  )

  it('seals again when a closed event is reopened and was not opened by hand', () => {
    const sealed = settings({ sealed: true })

    expect(isVoiceOpen(sealed, { status: 'closed' }, NOW)).toBe(true)
    expect(isVoiceOpen(sealed, { status: 'live' }, NOW)).toBe(false)
  })

  it('stays open after a reopening when the host opened it by hand', () => {
    expect(
      isVoiceOpen(settings({ sealed: true, opensAtMs: NOW_MS - 60_000 }), { status: 'live' }, NOW),
    ).toBe(true)
  })
})

describe('voiceSettingsViolation', () => {
  it('lets a host choose an opening time that is still to come, and move it freely', () => {
    const before = settings({ sealed: true, opensAtMs: NOW_MS + 3_600_000 })

    expect(
      voiceSettingsViolation(before, { ...before, opensAtMs: NOW_MS + 7_200_000 }, NOW_MS),
    ).toBeNull()
    expect(voiceSettingsViolation(before, { ...before, opensAtMs: null }, NOW_MS)).toBeNull()
    expect(voiceSettingsViolation(before, { ...before, opensAtMs: NOW_MS - 1 }, NOW_MS)).toBeNull()
  })

  it('refuses to move an opening time into the future once it has passed: opening is one-way', () => {
    const opened = settings({ sealed: true, opensAtMs: NOW_MS - 1 })

    const refused = voiceSettingsViolation(opened, { ...opened, opensAtMs: NOW_MS + 1 }, NOW_MS)

    expect(refused?.code).toBe('eventSettings.voiceOpenDone')
  })

  it('refuses to clear an opening time that has passed, which would seal it again', () => {
    const opened = settings({ sealed: true, opensAtMs: NOW_MS })

    const refused = voiceSettingsViolation(opened, { ...opened, opensAtMs: null }, NOW_MS)

    expect(refused?.code).toBe('eventSettings.voiceOpenDone')
  })

  it('lets an opening time that has passed be moved to another time that has passed', () => {
    const opened = settings({ sealed: true, opensAtMs: NOW_MS - 10 })

    expect(voiceSettingsViolation(opened, { ...opened, opensAtMs: NOW_MS - 5 }, NOW_MS)).toBeNull()
  })

  it('lets an unrelated change through on a book that has been opened', () => {
    const opened = settings({ sealed: true, opensAtMs: NOW_MS - 10 })

    expect(voiceSettingsViolation(opened, { ...opened, enabled: false }, NOW_MS)).toBeNull()
  })

  it('refuses an opening time that is not an instant', () => {
    const before = settings()

    expect(voiceSettingsViolation(before, { ...before, opensAtMs: Number.NaN }, NOW_MS)?.code).toBe(
      'eventSettings.voiceOpensAtInvalid',
    )
    expect(voiceOpensAtViolation(settings({ opensAtMs: Number.POSITIVE_INFINITY }))?.code).toBe(
      'eventSettings.voiceOpensAtInvalid',
    )
    expect(voiceOpensAtViolation(settings({ opensAtMs: 1 }))).toBeNull()
  })

  it('is what an event’s settings refuse at creation, without needing a clock', () => {
    const refused = EventSettings.create({ guestbookVoice: { opensAtMs: Number.NaN } })

    expect(!refused.ok && refused.error.code).toBe('eventSettings.voiceOpensAtInvalid')
  })
})

describe('restoreGuestbookVoiceSettings', () => {
  it('reads an absent key as off, not sealed and with no opening time', () => {
    expect(restoreGuestbookVoiceSettings(undefined)).toEqual(DEFAULT_GUESTBOOK_VOICE_SETTINGS)
    expect(restoreGuestbookVoiceSettings({})).toEqual(DEFAULT_GUESTBOOK_VOICE_SETTINGS)
  })

  it('reads what is stored', () => {
    expect(
      restoreGuestbookVoiceSettings({ enabled: true, sealed: true, opensAtMs: 1_800_000_000_000 }),
    ).toEqual({ enabled: true, sealed: true, opensAtMs: 1_800_000_000_000 })
  })

  it('never throws on what a hand-edited column holds: a field it cannot read takes its default', () => {
    expect(restoreGuestbookVoiceSettings({ enabled: 'yes', sealed: 1, opensAtMs: 'soon' })).toEqual(
      DEFAULT_GUESTBOOK_VOICE_SETTINGS,
    )
    expect(restoreGuestbookVoiceSettings({ opensAtMs: Number.NaN }).opensAtMs).toBeNull()
    expect(restoreGuestbookVoiceSettings(['enabled'])).toEqual(DEFAULT_GUESTBOOK_VOICE_SETTINGS)
    expect(restoreGuestbookVoiceSettings(null)).toEqual(DEFAULT_GUESTBOOK_VOICE_SETTINGS)
  })
})
