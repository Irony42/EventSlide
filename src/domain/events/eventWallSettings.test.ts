import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WALL_SETTINGS,
  mergeWallSettings,
  restoreWallSettings,
  wallSettingsViolation,
  type EventWallSettings,
} from './eventWallSettings'
import { EventSettings } from './eventSettings'

const wallOf = (patch: Partial<EventWallSettings>): EventWallSettings => ({
  ...DEFAULT_WALL_SETTINGS,
  ...patch,
})

describe('the wall settings group (spec 13)', () => {
  it('defaults to today’s behaviour: nothing chosen, the 8 s rhythm, no mixed wall', () => {
    expect(DEFAULT_WALL_SETTINGS).toEqual({
      layout: null,
      slideIntervalMs: null,
      mixedEnabled: false,
      mixedWallSeconds: 180,
      mixedSlideshowSeconds: 60,
      mixedAnchorMs: null,
    })
    expect(EventSettings.default().wall).toEqual(DEFAULT_WALL_SETTINGS)
  })

  it('merges field by field: a patch naming one key leaves the other alone', () => {
    const base = wallOf({ layout: 'mosaic', slideIntervalMs: 12_000 })

    expect(mergeWallSettings(base, { slideIntervalMs: 4_000 })).toEqual(
      wallOf({ layout: 'mosaic', slideIntervalMs: 4_000 }),
    )
    expect(mergeWallSettings(base, { layout: null })).toEqual(
      wallOf({ layout: null, slideIntervalMs: 12_000 }),
    )
    expect(mergeWallSettings(base, undefined)).toEqual(base)
    expect(mergeWallSettings(base, {})).toEqual(base)
  })

  it('merges through the settings too, without touching the rest of the policy', () => {
    const first = EventSettings.create({ wall: { layout: 'split' }, moderation: 'auto' })
    if (!first.ok) throw new Error('expected ok')
    const second = first.value.with({ wall: { slideIntervalMs: 20_000 } })
    if (!second.ok) throw new Error('expected ok')

    expect(second.value.wall).toEqual(wallOf({ layout: 'split', slideIntervalMs: 20_000 }))
    expect(second.value.moderation).toBe('auto')
  })

  it('refuses a layout outside the closed list and an interval outside 2 s to 10 min', () => {
    expect(wallSettingsViolation(wallOf({}))).toBeNull()
    expect(wallSettingsViolation(wallOf({ layout: 'mosaic', slideIntervalMs: 2_000 }))).toBeNull()
    expect(wallSettingsViolation(wallOf({ layout: 'nope' as 'mosaic' }))?.code).toBe(
      'eventSettings.wallLayoutInvalid',
    )
    expect(wallSettingsViolation(wallOf({ slideIntervalMs: 500 }))?.code).toBe(
      'slideInterval.tooShort',
    )
    expect(wallSettingsViolation(wallOf({ slideIntervalMs: 700_000 }))?.code).toBe(
      'slideInterval.tooLong',
    )
    expect(EventSettings.create({ wall: { slideIntervalMs: 1_500 } }).ok).toBe(false)
  })

  it('reads a stored group tolerantly: an unreadable field takes its default, nothing throws', () => {
    expect(restoreWallSettings(undefined)).toEqual(DEFAULT_WALL_SETTINGS)
    expect(restoreWallSettings('x')).toEqual(DEFAULT_WALL_SETTINGS)
    expect(restoreWallSettings(null)).toEqual(DEFAULT_WALL_SETTINGS)
    expect(restoreWallSettings({ layout: 'carousel', slideIntervalMs: 'fast' })).toEqual(
      DEFAULT_WALL_SETTINGS,
    )
    expect(restoreWallSettings({ layout: 'filmstrip', slideIntervalMs: 99 })).toEqual(
      wallOf({ layout: 'filmstrip' }),
    )
    expect(restoreWallSettings({ layout: 'collage', slideIntervalMs: 30_000 })).toEqual(
      wallOf({ layout: 'collage', slideIntervalMs: 30_000 }),
    )
  })
})

describe('the mixed wall keys (spec 09)', () => {
  it('bounds the wall phase to 30 s to 60 min and the slideshow phase to 15 s to 30 min', () => {
    const code = (patch: Partial<EventWallSettings>) => wallSettingsViolation(wallOf(patch))?.code
    expect(code({ mixedWallSeconds: 30, mixedSlideshowSeconds: 15 })).toBeUndefined()
    expect(code({ mixedWallSeconds: 3600, mixedSlideshowSeconds: 1800 })).toBeUndefined()
    expect(code({ mixedWallSeconds: 29 })).toBe('wallMixed.wallTooShort')
    expect(code({ mixedWallSeconds: 3601 })).toBe('wallMixed.wallTooLong')
    expect(code({ mixedSlideshowSeconds: 14 })).toBe('wallMixed.slideshowTooShort')
    expect(code({ mixedSlideshowSeconds: 1801 })).toBe('wallMixed.slideshowTooLong')
  })

  it('wants whole seconds', () => {
    expect(wallSettingsViolation(wallOf({ mixedWallSeconds: 90.5 }))?.code).toBe(
      'wallMixed.wallTooShort',
    )
    expect(wallSettingsViolation(wallOf({ mixedSlideshowSeconds: 20.5 }))?.code).toBe(
      'wallMixed.slideshowTooShort',
    )
  })

  it('merges its keys one by one, like the others', () => {
    const base = wallOf({ mixedEnabled: true, mixedAnchorMs: 5 })
    expect(mergeWallSettings(base, { mixedWallSeconds: 40 })).toEqual({
      ...base,
      mixedWallSeconds: 40,
    })
    expect(mergeWallSettings(base, { mixedEnabled: false }).mixedEnabled).toBe(false)
    expect(mergeWallSettings(base, { mixedSlideshowSeconds: 20 }).mixedSlideshowSeconds).toBe(20)
    expect(mergeWallSettings(base, { mixedAnchorMs: 9 }).mixedAnchorMs).toBe(9)
  })

  it('reads a blob without the keys (an event saved by 3.5.0) as switched off', () => {
    expect(restoreWallSettings({ layout: 'mosaic' })).toEqual(wallOf({ layout: 'mosaic' }))
  })

  it('reads stored mixed keys, and falls back per key on an unreadable one', () => {
    expect(
      restoreWallSettings({
        mixedEnabled: true,
        mixedWallSeconds: 120,
        mixedSlideshowSeconds: 45,
        mixedAnchorMs: 1_700_000_000_000,
      }),
    ).toEqual(
      wallOf({
        mixedEnabled: true,
        mixedWallSeconds: 120,
        mixedSlideshowSeconds: 45,
        mixedAnchorMs: 1_700_000_000_000,
      }),
    )
    expect(
      restoreWallSettings({
        mixedEnabled: 'yes',
        mixedWallSeconds: 5,
        mixedSlideshowSeconds: 'x',
        mixedAnchorMs: Number.NaN,
      }),
    ).toEqual(DEFAULT_WALL_SETTINGS)
  })
})
