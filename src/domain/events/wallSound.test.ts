import { describe, expect, it } from 'vitest'
import { EventSettings } from './eventSettings'
import {
  mergeWallSettings,
  restoreWallSettings,
  wallSettingsViolation,
  DEFAULT_WALL_SETTINGS,
} from './eventWallSettings'
import {
  DEFAULT_WALL_SOUND,
  WALL_SOUND_TONES,
  isWallSoundTone,
  isWallSoundVolume,
  readWallSound,
} from './wallSound'

describe('the wall sound (spec 12)', () => {
  it('is off by default, with the chime at volume 50', () => {
    expect(DEFAULT_WALL_SOUND).toEqual({ enabled: false, tone: 'chime', volume: 50 })
    expect(EventSettings.default().wall.soundEnabled).toBe(false)
  })

  it('knows exactly four tones', () => {
    expect(WALL_SOUND_TONES).toEqual(['chime', 'bell', 'drop', 'pop'])
    expect(isWallSoundTone('pop')).toBe(true)
    expect(isWallSoundTone('klaxon')).toBe(false)
    expect(isWallSoundTone(3)).toBe(false)
  })

  it('accepts a whole volume from 0 to 100 and nothing else', () => {
    for (const ok of [0, 50, 100]) expect(isWallSoundVolume(ok)).toBe(true)
    for (const bad of [-1, 101, 50.5, Number.NaN, '50', null]) {
      expect(isWallSoundVolume(bad)).toBe(false)
    }
  })

  it('refuses a bad tone or volume on write, with its own code', () => {
    const wall = DEFAULT_WALL_SETTINGS
    expect(wallSettingsViolation({ ...wall, soundTone: 'x' as 'pop' })?.code).toBe(
      'eventSettings.wallSoundToneInvalid',
    )
    expect(wallSettingsViolation({ ...wall, soundVolume: 101 })?.code).toBe(
      'eventSettings.wallSoundVolumeInvalid',
    )
    expect(wallSettingsViolation({ ...wall, soundVolume: 0, soundTone: 'bell' })).toBeNull()
  })

  it('merges key by key: a volume patch leaves the tone and the switch alone', () => {
    const base = { ...DEFAULT_WALL_SETTINGS, soundEnabled: true, soundTone: 'drop' as const }
    expect(mergeWallSettings(base, { soundVolume: 20 })).toEqual({ ...base, soundVolume: 20 })
    expect(mergeWallSettings(base, { soundEnabled: false }).soundTone).toBe('drop')
    expect(mergeWallSettings(base, { soundTone: 'pop' }).soundEnabled).toBe(true)
  })

  it('reads an absent or corrupt stored value as the default of each field', () => {
    expect(restoreWallSettings(undefined)).toMatchObject({
      soundEnabled: false,
      soundTone: 'chime',
      soundVolume: 50,
    })
    expect(
      restoreWallSettings({ soundEnabled: 'yes', soundTone: 'x', soundVolume: 500 }),
    ).toMatchObject({ soundEnabled: false, soundTone: 'chime', soundVolume: 50 })
    expect(
      restoreWallSettings({ soundEnabled: true, soundTone: 'bell', soundVolume: 0 }),
    ).toMatchObject({ soundEnabled: true, soundTone: 'bell', soundVolume: 0 })
    expect(readWallSound({ soundTone: 'pop' })).toEqual({
      enabled: false,
      tone: 'pop',
      volume: 50,
    })
  })
})
