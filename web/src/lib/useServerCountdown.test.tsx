import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGoneAfter, useServerCountdown, type CountdownChallenge } from './useServerCountdown'

const NOW = new Date('2026-06-20T21:00:00.000Z')

const challenge = (overrides: Partial<CountdownChallenge> = {}): CountdownChallenge => ({
  id: 'c1',
  endsAt: new Date(NOW.getTime() + 3_000).toISOString(),
  state: 'running',
  ...overrides,
})

describe('useServerCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts down one second at a time and is over at zero', async () => {
    const { result } = renderHook(() => useServerCountdown(challenge(), 0))
    expect(result.current).toEqual({ leftMs: 3_000, over: false })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(result.current).toEqual({ leftMs: 2_000, over: false })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(result.current).toEqual({ leftMs: 0, over: true })
  })

  it('is over by the server state alone, with time left on the clock', () => {
    const { result } = renderHook(() => useServerCountdown(challenge({ state: 'ended' }), 0))

    expect(result.current.over).toBe(true)
    expect(result.current.leftMs).toBe(3_000)
  })

  it('applies the offset to the server clock', () => {
    const { result } = renderHook(() => useServerCountdown(challenge(), 2_000))

    expect(result.current).toEqual({ leftMs: 1_000, over: false })
  })

  it('stops its interval when over', async () => {
    renderHook(() => useServerCountdown(challenge(), 0))
    expect(vi.getTimerCount()).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears its interval on unmount while it still counts', () => {
    const { unmount } = renderHook(() =>
      useServerCountdown(challenge({ endsAt: new Date(NOW.getTime() + 60_000).toISOString() }), 0),
    )
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('re-reads the clock when the challenge id changes after it was over', async () => {
    let current = challenge({ endsAt: new Date(NOW.getTime() + 1_000).toISOString() })
    const { result, rerender } = renderHook(() => useServerCountdown(current, 0))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(result.current.over).toBe(true)

    await act(async () => {
      vi.setSystemTime(NOW.getTime() + 60_000)
    })
    current = challenge({ id: 'c2', endsAt: new Date(NOW.getTime() + 62_000).toISOString() })
    rerender()

    expect(result.current).toEqual({ leftMs: 2_000, over: false })
  })
})

describe('useGoneAfter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is gone once over has lasted the delay, and calls back once', async () => {
    const onGone = vi.fn()
    const { result, rerender } = renderHook(({ over }) => useGoneAfter(over, 10_000, onGone), {
      initialProps: { over: false },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(result.current).toBe(false)

    rerender({ over: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_999)
    })
    expect(result.current).toBe(false)
    expect(onGone).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(result.current).toBe(true)
    expect(onGone).toHaveBeenCalledTimes(1)
  })

  it('leaves no timer behind on unmount', () => {
    const { unmount } = renderHook(() => useGoneAfter(true, 10_000))
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
