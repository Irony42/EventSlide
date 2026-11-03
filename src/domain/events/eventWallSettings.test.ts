import { describe, expect, it } from 'vitest'
import { DEFAULT_WALL_QR_SCALE } from './wallJoinCard'
import {
  DEFAULT_WALL_SETTINGS,
  mergeWallSettings,
  restoreWallSettings,
  wallSettingsViolation,
} from './eventWallSettings'
import { EventSettings } from './eventSettings'

const QR = { qrVisible: true, qrScale: DEFAULT_WALL_QR_SCALE, qrPlacement: 'bottom-end' } as const

describe('the wall settings group (spec 13)', () => {
  it('defaults to today’s behaviour: nothing chosen, the 8 s rhythm', () => {
    expect(DEFAULT_WALL_SETTINGS).toEqual({ layout: null, slideIntervalMs: null, ...QR })
    expect(EventSettings.default().wall).toEqual({ layout: null, slideIntervalMs: null, ...QR })
  })

  it('merges field by field: a patch naming one key leaves the other alone', () => {
    const base = { layout: 'mosaic', slideIntervalMs: 12_000, ...QR } as const

    expect(mergeWallSettings(base, { slideIntervalMs: 4_000 })).toEqual({
      layout: 'mosaic',
      slideIntervalMs: 4_000,
      ...QR,
    })
    expect(mergeWallSettings(base, { layout: null })).toEqual({
      layout: null,
      slideIntervalMs: 12_000,
      ...QR,
    })
    expect(mergeWallSettings(base, undefined)).toEqual(base)
    expect(mergeWallSettings(base, {})).toEqual(base)
  })

  it('merges through the settings too, without touching the rest of the policy', () => {
    const first = EventSettings.create({ wall: { layout: 'split' }, moderation: 'auto' })
    if (!first.ok) throw new Error('expected ok')
    const second = first.value.with({ wall: { slideIntervalMs: 20_000 } })
    if (!second.ok) throw new Error('expected ok')

    expect(second.value.wall).toEqual({ layout: 'split', slideIntervalMs: 20_000, ...QR })
    expect(second.value.moderation).toBe('auto')
  })

  it('refuses a layout outside the closed list and an interval outside 2 s to 10 min', () => {
    expect(wallSettingsViolation({ layout: null, slideIntervalMs: null, ...QR })).toBeNull()
    expect(wallSettingsViolation({ layout: 'mosaic', slideIntervalMs: 2_000, ...QR })).toBeNull()
    expect(
      wallSettingsViolation({ layout: 'nope' as 'mosaic', slideIntervalMs: null, ...QR })?.code,
    ).toBe('eventSettings.wallLayoutInvalid')
    expect(wallSettingsViolation({ layout: null, slideIntervalMs: 500, ...QR })?.code).toBe(
      'slideInterval.tooShort',
    )
    expect(wallSettingsViolation({ layout: null, slideIntervalMs: 700_000, ...QR })?.code).toBe(
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
    expect(restoreWallSettings({ layout: 'filmstrip', slideIntervalMs: 99 })).toEqual({
      layout: 'filmstrip',
      slideIntervalMs: null,
      ...QR,
    })
    expect(restoreWallSettings({ layout: 'collage', slideIntervalMs: 30_000 })).toEqual({
      layout: 'collage',
      slideIntervalMs: 30_000,
      ...QR,
    })
  })

  it('merges the invitation card keys one by one (spec 14)', () => {
    expect(mergeWallSettings(DEFAULT_WALL_SETTINGS, { qrScale: 1.3 })).toEqual({
      ...DEFAULT_WALL_SETTINGS,
      qrScale: 1.3,
    })
    expect(
      mergeWallSettings(
        { ...DEFAULT_WALL_SETTINGS, qrScale: 1.3 },
        { qrPlacement: 'top-start', qrVisible: false },
      ),
    ).toEqual({
      ...DEFAULT_WALL_SETTINGS,
      qrScale: 1.3,
      qrPlacement: 'top-start',
      qrVisible: false,
    })
  })

  it('refuses a QR scale outside 0.8 to 1.5 or off the 0.05 grid, and an unknown corner', () => {
    const base = DEFAULT_WALL_SETTINGS
    expect(wallSettingsViolation({ ...base, qrScale: 0.8 })).toBeNull()
    expect(wallSettingsViolation({ ...base, qrScale: 1.5 })).toBeNull()
    expect(wallSettingsViolation({ ...base, qrScale: 0.75 })?.code).toBe(
      'eventSettings.wallQrScaleInvalid',
    )
    expect(wallSettingsViolation({ ...base, qrScale: 1.55 })?.code).toBe(
      'eventSettings.wallQrScaleInvalid',
    )
    expect(wallSettingsViolation({ ...base, qrScale: 1.02 })?.code).toBe(
      'eventSettings.wallQrScaleInvalid',
    )
    expect(wallSettingsViolation({ ...base, qrScale: Number.NaN })?.code).toBe(
      'eventSettings.wallQrScaleInvalid',
    )
    expect(wallSettingsViolation({ ...base, qrPlacement: 'center' as 'top-end' })?.code).toBe(
      'eventSettings.wallQrPlacementInvalid',
    )
    expect(EventSettings.create({ wall: { qrScale: 3 } }).ok).toBe(false)
  })

  it('reads the card keys tolerantly: each unreadable one takes its default', () => {
    expect(
      restoreWallSettings({ qrVisible: false, qrScale: 1.25, qrPlacement: 'top-end' }),
    ).toEqual({ ...DEFAULT_WALL_SETTINGS, qrVisible: false, qrScale: 1.25, qrPlacement: 'top-end' })
    expect(restoreWallSettings({ qrVisible: 'no', qrScale: 9, qrPlacement: 'middle' })).toEqual(
      DEFAULT_WALL_SETTINGS,
    )
    expect(restoreWallSettings({ qrScale: '1.2' })).toEqual(DEFAULT_WALL_SETTINGS)
  })
})
