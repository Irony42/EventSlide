/**
 * The sound the wall may play when a photo or a clip joins it (spec 12): whether it is on, which
 * of four short tones, how loud. Pure rules; the three values live flat in the `wall` group of
 * the event's settings (`soundEnabled`, `soundTone`, `soundVolume`).
 *
 * **Off by default, always**: a wall that rings unasked is a failure of the evening. Playing is
 * also a per-screen decision made in the browser (a gesture is needed); this is only the host's
 * side of it.
 */
export const WALL_SOUND_TONES = ['chime', 'bell', 'drop', 'pop'] as const
export type WallSoundTone = (typeof WALL_SOUND_TONES)[number]

export const WALL_SOUND_VOLUME_MIN = 0
export const WALL_SOUND_VOLUME_MAX = 100

export interface WallSoundProps {
  readonly enabled: boolean
  readonly tone: WallSoundTone
  readonly volume: number
}

export const DEFAULT_WALL_SOUND: WallSoundProps = { enabled: false, tone: 'chime', volume: 50 }

export const isWallSoundTone = (value: unknown): value is WallSoundTone =>
  typeof value === 'string' && (WALL_SOUND_TONES as readonly string[]).includes(value)

/** A whole number from 0 to 100: 50.5 and 101 are refused. */
export const isWallSoundVolume = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= WALL_SOUND_VOLUME_MIN &&
  value <= WALL_SOUND_VOLUME_MAX

/** Reads a stored triple tolerantly: each field that is absent or unreadable takes its default. */
export const readWallSound = (raw: {
  readonly soundEnabled?: unknown
  readonly soundTone?: unknown
  readonly soundVolume?: unknown
}): WallSoundProps => ({
  enabled: typeof raw.soundEnabled === 'boolean' ? raw.soundEnabled : DEFAULT_WALL_SOUND.enabled,
  tone: isWallSoundTone(raw.soundTone) ? raw.soundTone : DEFAULT_WALL_SOUND.tone,
  volume: isWallSoundVolume(raw.soundVolume) ? raw.soundVolume : DEFAULT_WALL_SOUND.volume,
})
