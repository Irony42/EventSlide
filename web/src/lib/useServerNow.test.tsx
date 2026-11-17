import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { SERVER_NOW_TICK_MS, useServerNow } from './useServerNow'

const LOCAL = Date.parse('2026-12-30T12:00:00.000Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(LOCAL)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useServerNow', () => {
  it('is this machine’s clock moved by the offset measured at the last read', () => {
    const { result } = renderHook(() => useServerNow(-28 * 86_400_000))

    expect(result.current).toBe(LOCAL - 28 * 86_400_000)
  })

  it('works out the time again every minute, and not between', () => {
    const { result } = renderHook(() => useServerNow(0))

    act(() => {
      vi.setSystemTime(LOCAL + 10_000)
      vi.advanceTimersByTime(SERVER_NOW_TICK_MS - 1)
    })
    expect(result.current).toBe(LOCAL)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(LOCAL + 10_000 + SERVER_NOW_TICK_MS)
  })

  it('takes the local reading again when the offset changes, so the new offset meets a fresh reading', () => {
    const { result, rerender } = renderHook(({ offset }) => useServerNow(offset), {
      initialProps: { offset: 0 },
    })

    vi.setSystemTime(LOCAL + 30_000)
    rerender({ offset: 5_000 })

    expect(result.current).toBe(LOCAL + 30_000 + 5_000)
  })

  it('leaves no timer behind when the page is left', () => {
    const { unmount } = renderHook(() => useServerNow(0))
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
