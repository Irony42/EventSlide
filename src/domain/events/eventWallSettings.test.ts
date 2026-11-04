import { describe, expect, it } from 'vitest'
import { DEFAULT_WALL_QR_SCALE } from './wallJoinCard'
import {
  DEFAULT_WALL_SETTINGS,
  mergeWallSettings,
  restoreWallSettings,
  wallSettingsViolation,
  type EventWallSettings,
} from './eventWallSettings'
import { EventSettings } from './eventSettings'

const QR = {
  qrVisible: true,
  qrScale: DEFAULT_WALL_QR_SCALE,
  qrPlacement: 'bottom-end',
  mixedEnabled: false,
  mixedWallSeconds: 180,
  mixedSlideshowSeconds: 60,
  mixedAnchorMs: null,
  freshLane: true,
  tilt: true,
  showTime: false,
  souvenirCounter: false,
  newPhotoSignal: false,
} as const

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

  it('defaults the display switches to today’s behaviour and merges them key by key', () => {
    expect(DEFAULT_WALL_SETTINGS).toMatchObject({ freshLane: true, tilt: true })
    const merged = mergeWallSettings(DEFAULT_WALL_SETTINGS, { tilt: false })
    expect(merged).toEqual({ ...DEFAULT_WALL_SETTINGS, tilt: false })
    expect(mergeWallSettings(merged, { freshLane: false })).toMatchObject({
      freshLane: false,
      tilt: false,
      showTime: false,
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
      ...QR,
    })
    expect(restoreWallSettings({ freshLane: 'no', tilt: 0 })).toEqual(DEFAULT_WALL_SETTINGS)
    expect(restoreWallSettings({ freshLane: false, tilt: false })).toMatchObject({
      freshLane: false,
      tilt: false,
      showTime: false,
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
      freshLane: true,
      tilt: true,
      showTime: false,
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

const wallOf = (patch: Partial<EventWallSettings>): EventWallSettings => ({
  ...DEFAULT_WALL_SETTINGS,
  ...patch,
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
