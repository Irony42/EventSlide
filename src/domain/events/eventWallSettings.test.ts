import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WALL_SETTINGS,
  mergeWallSettings,
  restoreWallSettings,
  wallSettingsViolation,
} from './eventWallSettings'
import { EventSettings } from './eventSettings'

describe('the wall settings group (spec 13)', () => {
  it('defaults to today’s behaviour: nothing chosen, the 8 s rhythm', () => {
    expect(DEFAULT_WALL_SETTINGS).toEqual({
      layout: null,
      slideIntervalMs: null,
      souvenirCounter: false,
      newPhotoSignal: false,
    })
    expect(EventSettings.default().wall).toEqual({
      layout: null,
      slideIntervalMs: null,
      souvenirCounter: false,
      newPhotoSignal: false,
    })
  })

  it('merges field by field: a patch naming one key leaves the other alone', () => {
    const base = {
      layout: 'mosaic',
      slideIntervalMs: 12_000,
      souvenirCounter: false,
      newPhotoSignal: false,
    } as const

    expect(mergeWallSettings(base, { slideIntervalMs: 4_000 })).toEqual({
      layout: 'mosaic',
      slideIntervalMs: 4_000,
      souvenirCounter: false,
      newPhotoSignal: false,
    })
    expect(mergeWallSettings(base, { layout: null })).toEqual({
      layout: null,
      slideIntervalMs: 12_000,
      souvenirCounter: false,
      newPhotoSignal: false,
    })
    expect(mergeWallSettings(base, undefined)).toEqual(base)
    expect(mergeWallSettings(base, {})).toEqual(base)
  })

  it('merges through the settings too, without touching the rest of the policy', () => {
    const first = EventSettings.create({ wall: { layout: 'split' }, moderation: 'auto' })
    if (!first.ok) throw new Error('expected ok')
    const second = first.value.with({ wall: { slideIntervalMs: 20_000 } })
    if (!second.ok) throw new Error('expected ok')

    expect(second.value.wall).toEqual({
      layout: 'split',
      slideIntervalMs: 20_000,
      souvenirCounter: false,
      newPhotoSignal: false,
    })
    expect(second.value.moderation).toBe('auto')
  })

  it('refuses a layout outside the closed list and an interval outside 2 s to 10 min', () => {
    expect(
      wallSettingsViolation({
        layout: null,
        slideIntervalMs: null,
        souvenirCounter: false,
        newPhotoSignal: false,
      }),
    ).toBeNull()
    expect(
      wallSettingsViolation({
        layout: 'mosaic',
        slideIntervalMs: 2_000,
        souvenirCounter: false,
        newPhotoSignal: false,
      }),
    ).toBeNull()
    expect(
      wallSettingsViolation({ ...DEFAULT_WALL_SETTINGS, layout: 'nope' as 'mosaic' })?.code,
    ).toBe('eventSettings.wallLayoutInvalid')
    expect(
      wallSettingsViolation({
        layout: null,
        slideIntervalMs: 500,
        souvenirCounter: false,
        newPhotoSignal: false,
      })?.code,
    ).toBe('slideInterval.tooShort')
    expect(
      wallSettingsViolation({
        layout: null,
        slideIntervalMs: 700_000,
        souvenirCounter: false,
        newPhotoSignal: false,
      })?.code,
    ).toBe('slideInterval.tooLong')
    expect(EventSettings.create({ wall: { slideIntervalMs: 1_500 } }).ok).toBe(false)
  })

  it('reads a stored group tolerantly: an unreadable field takes its default, nothing throws', () => {
    expect(restoreWallSettings(undefined)).toEqual(DEFAULT_WALL_SETTINGS)
    expect(restoreWallSettings('x')).toEqual(DEFAULT_WALL_SETTINGS)
    expect(restoreWallSettings(null)).toEqual(DEFAULT_WALL_SETTINGS)
    expect(restoreWallSettings({ layout: 'carousel', slideIntervalMs: 'fast' })).toEqual(
      DEFAULT_WALL_SETTINGS,
    )
    expect(restoreWallSettings({ layout: 'filmstrip', slideIntervalMs: 99 })).toEqual({
      layout: 'filmstrip',
      slideIntervalMs: null,
      souvenirCounter: false,
      newPhotoSignal: false,
    })
    expect(restoreWallSettings({ layout: 'collage', slideIntervalMs: 30_000 })).toEqual({
      layout: 'collage',
      slideIntervalMs: 30_000,
      souvenirCounter: false,
      newPhotoSignal: false,
    })
  })

  it('merges the spec 11 switches key by key and reads only a stored true as on', () => {
    expect(mergeWallSettings(DEFAULT_WALL_SETTINGS, { souvenirCounter: true })).toMatchObject({
      souvenirCounter: true,
      newPhotoSignal: false,
    })
    expect(
      mergeWallSettings(
        { ...DEFAULT_WALL_SETTINGS, souvenirCounter: true },
        { newPhotoSignal: true },
      ),
    ).toMatchObject({ souvenirCounter: true, newPhotoSignal: true })
    expect(restoreWallSettings({ souvenirCounter: true, newPhotoSignal: 'true' })).toMatchObject({
      souvenirCounter: true,
      newPhotoSignal: false,
    })
  })
})
