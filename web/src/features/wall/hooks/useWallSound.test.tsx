import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WallResponse } from '../../../lib/api/dto'
import { aWallItem, aWallResponse } from '../../../testing/renderWithProviders'
import type { WallSoundPlayer } from '../../../lib/wallSoundPlayer'
import { WALL_SOUND_MIN_GAP_MS } from '../../../lib/wallSoundPlayer'
import { useWallSound, wallSoundFlagKey } from './useWallSound'

interface FakePlayer extends WallSoundPlayer {
  plays: Array<{ tone: string; volume: number }>
  loads: string[]
  activations: number
  allowed: boolean
  isRunning: boolean
  closed: number
}

const fakePlayer = (allowed = true): FakePlayer => {
  const fake: FakePlayer = {
    plays: [],
    loads: [],
    activations: 0,
    allowed,
    isRunning: false,
    closed: 0,
    running: () => fake.isRunning,
    activate: () => {
      fake.activations += 1
      fake.isRunning = fake.allowed
      return Promise.resolve(fake.isRunning)
    },
    load: (tone) => {
      fake.loads.push(tone)
      return Promise.resolve()
    },
    play: (tone, volume) => {
      if (fake.isRunning && volume > 0) fake.plays.push({ tone, volume })
    },
    close: () => {
      fake.closed += 1
    },
  }
  return fake
}

const SOUND_ON = { enabled: true, tone: 'bell', volume: 60 } as const

const read = (
  ids: readonly string[],
  total: number,
  sound: WallResponse['sound'] | null = SOUND_ON,
) =>
  aWallResponse({
    items: ids.map((id) => aWallItem({ id })),
    souvenirCount: total,
    ...(sound === null ? {} : { sound }),
  })

const NOW = 1_800_000_000_000

describe('the wall sound hook (spec 12)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const setup = (player = fakePlayer()) => {
    const hook = renderHook(() => useWallSound('mariage', () => player))
    return { ...hook, player }
  }

  const activate = async (hook: ReturnType<typeof setup>) => {
    await act(async () => {
      hook.result.current.activate()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('is silent on the first read, which only sets the reference', async () => {
    const hook = setup()
    act(() => hook.result.current.observe(read(['a', 'b'], 2)))
    await activate(hook)
    const before = hook.player.plays.length

    act(() => hook.result.current.observe(read(['a', 'b'], 2)))

    expect(hook.player.plays.length).toBe(before)
  })

  it('plays nothing, and raises nothing, while the browser has not allowed this page', () => {
    const hook = setup(fakePlayer(false))
    act(() => hook.result.current.observe(read(['a'], 1)))
    vi.setSystemTime(NOW + 10_000)

    act(() => hook.result.current.observe(read(['b', 'a'], 2)))

    expect(hook.player.plays).toEqual([])
    expect(hook.result.current.active).toBe(false)
  })

  it('activates on a gesture with a test sound, then rings for a photo that arrives', async () => {
    const hook = setup()
    act(() => hook.result.current.observe(read(['a'], 1)))
    await activate(hook)

    expect(hook.result.current.active).toBe(true)
    expect(hook.player.plays).toEqual([{ tone: 'bell', volume: 60 }])
    expect(window.localStorage.getItem(wallSoundFlagKey('mariage'))).toBe('1')

    vi.setSystemTime(NOW + WALL_SOUND_MIN_GAP_MS + 1_000)
    act(() => hook.result.current.observe(read(['b', 'a'], 2)))

    expect(hook.player.plays).toHaveLength(2)
  })

  it('rings once for a burst, and not again inside the 5 s window', async () => {
    const hook = setup()
    act(() => hook.result.current.observe(read(['a'], 1)))
    await activate(hook)
    hook.player.plays.length = 0

    vi.setSystemTime(NOW + 10_000)
    act(() => hook.result.current.observe(read(['d', 'c', 'b', 'a'], 4)))
    vi.setSystemTime(NOW + 12_000)
    act(() => hook.result.current.observe(read(['e', 'd', 'c', 'b', 'a'], 5)))

    expect(hook.player.plays).toHaveLength(1)
  })

  it('does not ring for a deletion that lets an older photo into the window', async () => {
    const hook = setup()
    act(() => hook.result.current.observe(read(['a', 'b'], 3)))
    await activate(hook)
    hook.player.plays.length = 0

    vi.setSystemTime(NOW + 10_000)
    act(() => hook.result.current.observe(read(['b', 'c'], 2)))

    expect(hook.player.plays).toEqual([])
  })

  it('falls silent as soon as the host switches it off, without a reload', async () => {
    const hook = setup()
    act(() => hook.result.current.observe(read(['a'], 1)))
    await activate(hook)
    hook.player.plays.length = 0

    vi.setSystemTime(NOW + 10_000)
    act(() =>
      hook.result.current.observe(
        read(['b', 'a'], 2, { enabled: false, tone: 'bell', volume: 60 }),
      ),
    )

    expect(hook.player.plays).toEqual([])
    expect(hook.result.current.enabled).toBe(false)
  })

  it('loads nothing at volume 0, and loads the chosen tone once the screen is active', async () => {
    const quiet = setup()
    act(() =>
      quiet.result.current.observe(read(['a'], 1, { enabled: true, tone: 'drop', volume: 0 })),
    )
    await activate(quiet)
    expect(quiet.player.loads).toEqual([])
    expect(quiet.player.plays).toEqual([])

    const loud = setup()
    act(() =>
      loud.result.current.observe(read(['a'], 1, { enabled: true, tone: 'drop', volume: 40 })),
    )
    await activate(loud)
    expect(loud.player.loads).toContain('drop')
  })

  it('stays muted with no sound field at all (an older server)', async () => {
    const hook = setup()
    act(() => hook.result.current.observe(read(['a'], 1, null)))
    vi.setSystemTime(NOW + 10_000)

    act(() => hook.result.current.observe(read(['b', 'a'], 2, null)))

    expect(hook.result.current.enabled).toBe(false)
    expect(hook.player.plays).toEqual([])
  })

  it('after a reload, a screen that was activated before resumes at the first gesture, not before', async () => {
    window.localStorage.setItem(wallSoundFlagKey('mariage'), '1')
    const player = fakePlayer(false)
    const hook = renderHook(() => useWallSound('mariage', () => player))
    await act(async () => {
      hook.result.current.observe(read(['a'], 1))
      await Promise.resolve()
    })
    expect(hook.result.current.active).toBe(false)

    player.allowed = true
    await act(async () => {
      window.dispatchEvent(new Event('pointerdown'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(hook.result.current.active).toBe(true)
  })

  it('does not listen for gestures on a screen that was never activated (the second projector)', async () => {
    const hook = setup()
    act(() => hook.result.current.observe(read(['a'], 1)))
    const before = hook.player.activations

    await act(async () => {
      window.dispatchEvent(new Event('pointerdown'))
      await Promise.resolve()
    })

    expect(hook.player.activations).toBe(before)
    expect(hook.result.current.active).toBe(false)
  })

  it('closes its audio context when the wall unmounts', async () => {
    const hook = setup()
    act(() => hook.result.current.observe(read(['a'], 1)))
    await activate(hook)

    hook.unmount()

    expect(hook.player.closed).toBe(1)
  })
})
