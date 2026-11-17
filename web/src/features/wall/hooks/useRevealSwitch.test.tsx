import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WallRevealDto } from '../../../lib/api/dto'
import { REVEAL_RETRY_MAX, REVEAL_RETRY_MS, useRevealSwitch } from './useRevealSwitch'

const SERVER_NOW = 1_800_000_000_000

const reveal = (overrides: Partial<WallRevealDto> = {}): WallRevealDto => ({
  enabled: true,
  revealed: false,
  atMs: SERVER_NOW + 60_000,
  serverNowMs: SERVER_NOW,
  film: false,
  readyCount: 3,
  ...overrides,
})

const noJitter = (): number => 0
const middleJitter = (): number => 0.5

describe('useRevealSwitch (spec 23)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads again at the hour of the answer, and not before', () => {
    const read = vi.fn()
    renderHook(() => useRevealSwitch(reveal(), read, noJitter))

    vi.advanceTimersByTime(59_999)
    expect(read).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(read).toHaveBeenCalledOnce()
  })

  it('does not depend on this machine’s clock: five minutes off either way, the wait is the same', () => {
    for (const skewMs of [-5 * 60_000, 5 * 60_000]) {
      vi.setSystemTime(SERVER_NOW + skewMs)
      const read = vi.fn()
      const { unmount } = renderHook(() => useRevealSwitch(reveal(), read, noJitter))

      vi.advanceTimersByTime(59_999)
      expect(read).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(read).toHaveBeenCalledOnce()
      unmount()
    }
  })

  it('adds a draw of up to three seconds, so a room of screens does not ask in one millisecond', () => {
    const read = vi.fn()
    renderHook(() => useRevealSwitch(reveal(), read, middleJitter))

    vi.advanceTimersByTime(60_000 + 1_499)
    expect(read).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(read).toHaveBeenCalledOnce()
  })

  it.each([
    ['the evening is revealed', reveal({ revealed: true })],
    ['the host reveals by hand', reveal({ atMs: null })],
    ['the mode is off', reveal({ enabled: false, revealed: true })],
    ['an older server sent no block', undefined],
  ])('arms nothing when %s', (_why, block) => {
    const read = vi.fn()
    renderHook(() => useRevealSwitch(block, read, noJitter))

    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(24 * 3_600_000)
    expect(read).not.toHaveBeenCalled()
  })

  it('clears its timer on unmount, so an eight-hour evening accumulates nothing', () => {
    const read = vi.fn()
    const { unmount } = renderHook(() => useRevealSwitch(reveal(), read, noJitter))
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(120_000)
    expect(read).not.toHaveBeenCalled()
  })

  it('asks again when the read at the hour still finds the evening waiting, a bounded number of times', () => {
    const read = vi.fn()
    renderHook(() => useRevealSwitch(reveal(), read, noJitter))

    vi.advanceTimersByTime(60_000)
    expect(read).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(REVEAL_RETRY_MS)
    expect(read).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(60 * 60_000)
    expect(read).toHaveBeenCalledTimes(1 + REVEAL_RETRY_MAX)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops retrying once the answer moves', () => {
    const read = vi.fn()
    const { rerender } = renderHook(
      ({ block }: { block: WallRevealDto }) => useRevealSwitch(block, read, noJitter),
      { initialProps: { block: reveal() } },
    )
    vi.advanceTimersByTime(60_000)
    rerender({ block: reveal({ revealed: true }) })

    vi.advanceTimersByTime(60 * 60_000)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('waits again when the host moves the hour', () => {
    const read = vi.fn()
    const { rerender } = renderHook(
      ({ block }: { block: WallRevealDto }) => useRevealSwitch(block, read, noJitter),
      { initialProps: { block: reveal() } },
    )

    vi.advanceTimersByTime(30_000)
    rerender({
      block: reveal({ atMs: SERVER_NOW + 10 * 60_000, serverNowMs: SERVER_NOW + 30_000 }),
    })

    vi.advanceTimersByTime(10 * 60_000 - 30_000 - 1)
    expect(read).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(read).toHaveBeenCalledOnce()
  })
})
