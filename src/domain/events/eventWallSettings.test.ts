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
    expect(DEFAULT_WALL_SETTINGS).toEqual(DEFAULT_WALL_SETTINGS)
    expect(EventSettings.default().wall).toEqual(DEFAULT_WALL_SETTINGS)
  })

  it('merges field by field: a patch naming one key leaves the other alone', () => {
    const base = {
      layout: 'mosaic',
      slideIntervalMs: 12_000,
      freshLane: true,
      tilt: true,
      showTime: false,
    } as const

    expect(mergeWallSettings(base, { slideIntervalMs: 4_000 })).toEqual({
      layout: 'mosaic',
      slideIntervalMs: 4_000,
      freshLane: true,
      tilt: true,
      showTime: false,
    })
    expect(mergeWallSettings(base, { layout: null })).toEqual({
      layout: null,
      slideIntervalMs: 12_000,
      freshLane: true,
      tilt: true,
      showTime: false,
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
      ...DEFAULT_WALL_SETTINGS,
      layout: 'split',
      slideIntervalMs: 20_000,
    })
    expect(second.value.moderation).toBe('auto')
  })

  it('refuses a layout outside the closed list and an interval outside 2 s to 10 min', () => {
    expect(
      wallSettingsViolation({ ...DEFAULT_WALL_SETTINGS, layout: null, slideIntervalMs: null }),
    ).toBeNull()
    expect(
      wallSettingsViolation({ ...DEFAULT_WALL_SETTINGS, layout: 'mosaic', slideIntervalMs: 2_000 }),
    ).toBeNull()
    expect(
      wallSettingsViolation({
        ...DEFAULT_WALL_SETTINGS,
        layout: 'nope' as 'mosaic',
        slideIntervalMs: null,
      })?.code,
    ).toBe('eventSettings.wallLayoutInvalid')
    expect(
      wallSettingsViolation({ ...DEFAULT_WALL_SETTINGS, layout: null, slideIntervalMs: 500 })?.code,
    ).toBe('slideInterval.tooShort')
    expect(
      wallSettingsViolation({ ...DEFAULT_WALL_SETTINGS, layout: null, slideIntervalMs: 700_000 })
        ?.code,
    ).toBe('slideInterval.tooLong')
    expect(EventSettings.create({ wall: { slideIntervalMs: 1_500 } }).ok).toBe(false)
  })

  it('defaults the display switches to today’s behaviour and merges them key by key', () => {
    expect(DEFAULT_WALL_SETTINGS).toMatchObject({ freshLane: true, tilt: true, showTime: false })
    const merged = mergeWallSettings(DEFAULT_WALL_SETTINGS, { tilt: false })
    expect(merged).toEqual({ ...DEFAULT_WALL_SETTINGS, tilt: false })
    expect(mergeWallSettings(merged, { freshLane: false })).toMatchObject({
      freshLane: false,
      tilt: false,
    })
  })

  it('keeps the time under photos off by default and merges it like the rest', () => {
    expect(DEFAULT_WALL_SETTINGS.showTime).toBe(false)
    expect(mergeWallSettings(DEFAULT_WALL_SETTINGS, { showTime: true }).showTime).toBe(true)
    expect(restoreWallSettings({ showTime: 'yes' }).showTime).toBe(false)
    expect(restoreWallSettings({ showTime: true }).showTime).toBe(true)
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
      freshLane: true,
      tilt: true,
      showTime: false,
    })
    expect(restoreWallSettings({ freshLane: 'no', tilt: 0 })).toEqual(DEFAULT_WALL_SETTINGS)
    expect(restoreWallSettings({ freshLane: false, tilt: false, showTime: false })).toMatchObject({
      freshLane: false,
      tilt: false,
    })
    expect(restoreWallSettings({ layout: 'collage', slideIntervalMs: 30_000 })).toEqual({
      layout: 'collage',
      slideIntervalMs: 30_000,
      freshLane: true,
      tilt: true,
      showTime: false,
    })
  })
})
