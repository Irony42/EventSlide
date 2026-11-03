import type { EventSettingsDto } from './api/dto'

/**
 * The sound a wall (or the host's "Test" button) plays for a new photo (spec 12).
 *
 * One `AudioContext` for the whole evening, created on the first gesture; one decoded buffer per
 * tone, fetched from our own origin (`/sounds/<tone>.mp3`, derived from the closed list, never
 * from a server value). A browser keeps the context suspended until a gesture has happened on the
 * page: that is not an error, it is the normal state of a wall that reloaded, and playing then is
 * simply a no-op. Nothing here retries, loops, or plays silence to stay awake.
 */
export type WallSoundTone = EventSettingsDto['wall']['soundTone']

export const WALL_SOUND_TONES: readonly WallSoundTone[] = ['chime', 'bell', 'drop', 'pop']

/** At most one sound per window; the first to arrive rings, the others are dropped. */
export const WALL_SOUND_MIN_GAP_MS = 5_000

/** Attack, so a sound never starts with a click. */
const ATTACK_SECONDS = 0.005

export const wallSoundUrl = (tone: WallSoundTone): string => `/sounds/${tone}.mp3`

/** Perceptual curve, capped at 0.8 so no setting saturates a small speaker. 0 is silence. */
export const wallSoundGain = (volume: number): number => (volume / 100) ** 2 * 0.8

export interface WallSoundPlayer {
  /** Whether the browser lets this page play right now (a gesture has happened and `resume` worked). */
  readonly running: () => boolean
  /** Call from a gesture. Creates the context, tries `resume()`, never throws. Resolves `running()`. */
  readonly activate: () => Promise<boolean>
  /** Fetches and decodes one tone, once. Never throws: a missing file is a silent wall. */
  readonly load: (tone: WallSoundTone) => Promise<void>
  /** Plays a loaded tone now. No-op when volume is 0, the context is not running or the tone is not loaded. */
  readonly play: (tone: WallSoundTone, volume: number) => void
  /** Closes the context at unmount. */
  readonly close: () => void
}

export interface WallSoundDeps {
  readonly createContext?: () => AudioContext
  readonly fetchBytes?: (url: string) => Promise<ArrayBuffer>
}

const defaultFetchBytes = async (url: string): Promise<ArrayBuffer> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`sound ${url}: ${response.status}`)
  return response.arrayBuffer()
}

export const createWallSoundPlayer = (deps: WallSoundDeps = {}): WallSoundPlayer => {
  const createContext = deps.createContext ?? (() => new AudioContext())
  const fetchBytes = deps.fetchBytes ?? defaultFetchBytes
  let context: AudioContext | null = null
  const buffers = new Map<WallSoundTone, AudioBuffer>()
  const loading = new Map<WallSoundTone, Promise<void>>()

  const running = () => context !== null && context.state === 'running'

  const activate = async () => {
    try {
      context ??= createContext()
      if (context.state !== 'running') await context.resume()
    } catch {
      // A refused resume is the browser's answer, not a failure: the wall stays silent.
    }
    return running()
  }

  const load = (tone: WallSoundTone): Promise<void> => {
    const pending = loading.get(tone)
    if (pending !== undefined) return pending
    const started = (async () => {
      try {
        if (context === null) {
          loading.delete(tone)
          return
        }
        const bytes = await fetchBytes(wallSoundUrl(tone))
        buffers.set(tone, await context.decodeAudioData(bytes))
      } catch {
        // Not loaded, so `play` stays silent; a later `load` may try again.
        loading.delete(tone)
      }
    })()
    loading.set(tone, started)
    return started
  }

  const play = (tone: WallSoundTone, volume: number) => {
    const buffer = buffers.get(tone)
    if (context === null || context.state !== 'running' || buffer === undefined) return
    const peak = wallSoundGain(volume)
    if (peak <= 0) return
    const source = context.createBufferSource()
    const gain = context.createGain()
    source.buffer = buffer
    gain.gain.setValueAtTime(0, context.currentTime)
    gain.gain.linearRampToValueAtTime(peak, context.currentTime + ATTACK_SECONDS)
    source.connect(gain)
    gain.connect(context.destination)
    source.start()
  }

  const close = () => {
    const closing = context
    context = null
    buffers.clear()
    loading.clear()
    if (closing !== null && closing.state !== 'closed') void closing.close().catch(() => undefined)
  }

  return { running, activate, load, play, close }
}
