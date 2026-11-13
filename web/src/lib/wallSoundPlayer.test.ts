import { describe, expect, it, vi } from 'vitest'
import {
  createWallSoundPlayer,
  wallSoundGain,
  wallSoundUrl,
  WALL_SOUND_TONES,
} from './wallSoundPlayer'

interface Fake {
  state: AudioContextState
  resumes: number
  starts: number
  peaks: number[]
  resumeFails: boolean
  context: AudioContext
}

const fakeContext = (initial: AudioContextState = 'suspended'): Fake => {
  const fake = {
    state: initial,
    resumes: 0,
    starts: 0,
    peaks: [],
    resumeFails: false,
  } as unknown as Fake
  const param = {
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: (value: number) => fake.peaks.push(value),
  }
  fake.context = {
    get state() {
      return fake.state
    },
    currentTime: 0,
    destination: {},
    resume: () => {
      fake.resumes += 1
      if (fake.resumeFails) return Promise.reject(new Error('NotAllowedError'))
      fake.state = 'running'
      return Promise.resolve()
    },
    close: () => {
      fake.state = 'closed'
      return Promise.resolve()
    },
    decodeAudioData: () => Promise.resolve({} as AudioBuffer),
    createGain: () => ({ gain: param, connect: vi.fn() }),
    createBufferSource: () => ({
      buffer: null,
      connect: vi.fn(),
      start: () => {
        fake.starts += 1
      },
    }),
  } as unknown as AudioContext
  return fake
}

const bytes = () => Promise.resolve(new ArrayBuffer(8))

describe('the wall sound player (spec 12)', () => {
  it('derives a file from the closed list of tones, never from a free string', () => {
    expect(WALL_SOUND_TONES.map(wallSoundUrl)).toEqual([
      '/sounds/chime.mp3',
      '/sounds/bell.mp3',
      '/sounds/drop.mp3',
      '/sounds/pop.mp3',
    ])
  })

  it('maps the volume to a squared gain capped at 0.8', () => {
    expect(wallSoundGain(0)).toBe(0)
    expect(wallSoundGain(100)).toBeCloseTo(0.8)
    expect(wallSoundGain(50)).toBeCloseTo(0.2)
  })

  it('plays nothing, and raises nothing, while the browser keeps the context suspended', async () => {
    const fake = fakeContext()
    fake.resumeFails = true
    const player = createWallSoundPlayer({ createContext: () => fake.context, fetchBytes: bytes })

    expect(await player.activate()).toBe(false)
    await player.load('chime')
    player.play('chime', 50)

    expect(fake.starts).toBe(0)
    expect(player.running()).toBe(false)
  })

  it('resumes on a gesture, then plays a loaded tone with a short attack', async () => {
    const fake = fakeContext()
    const player = createWallSoundPlayer({ createContext: () => fake.context, fetchBytes: bytes })

    expect(await player.activate()).toBe(true)
    await player.load('bell')
    player.play('bell', 100)

    expect(fake.starts).toBe(1)
    expect(fake.peaks[0]).toBeCloseTo(0.8)
  })

  it('does not start a sound at volume 0, nor one that was never loaded', async () => {
    const fake = fakeContext()
    const player = createWallSoundPlayer({ createContext: () => fake.context, fetchBytes: bytes })
    await player.activate()
    await player.load('pop')

    player.play('pop', 0)
    player.play('drop', 50)

    expect(fake.starts).toBe(0)
  })

  it('swallows a missing file, retries later, and fetches a tone only once when it worked', async () => {
    const fake = fakeContext()
    const fetchBytes = vi.fn().mockRejectedValueOnce(new Error('404')).mockImplementation(bytes)
    const player = createWallSoundPlayer({ createContext: () => fake.context, fetchBytes })
    await player.activate()

    await player.load('drop')
    player.play('drop', 50)
    expect(fake.starts).toBe(0)

    await player.load('drop')
    await player.load('drop')
    player.play('drop', 50)
    expect(fetchBytes).toHaveBeenCalledTimes(2)
    expect(fake.starts).toBe(1)
  })

  it('loads nothing before a gesture has created the context', async () => {
    const fetchBytes = vi.fn(bytes)
    const player = createWallSoundPlayer({ fetchBytes })

    await player.load('chime')

    expect(fetchBytes).not.toHaveBeenCalled()
  })

  it('tries again once the context exists when a load came before the gesture', async () => {
    // BUG-24: a load that returned at once (no context yet) used to stay cached as a
    // finished promise, so the tone was never fetched for the rest of the evening.
    const fake = fakeContext()
    const fetchBytes = vi.fn(bytes)
    const player = createWallSoundPlayer({ createContext: () => fake.context, fetchBytes })
    await player.load('chime')
    await player.activate()

    await player.load('chime')
    player.play('chime', 50)

    expect(fetchBytes).toHaveBeenCalledTimes(1)
    expect(fake.starts).toBe(1)
  })

  it('closes its context once', async () => {
    const fake = fakeContext()
    const player = createWallSoundPlayer({ createContext: () => fake.context, fetchBytes: bytes })
    await player.activate()

    player.close()
    player.close()

    expect(fake.state).toBe('closed')
    expect(player.running()).toBe(false)
  })
})
