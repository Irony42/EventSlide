import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CURSOR_IDLE_MS, useIdleCursor } from './useIdleCursor'

/**
 * The arrow a host left on the photo when they clicked into the tab is not on screen for the
 * whole evening, and is there the moment somebody touches the mouse.
 */
describe('useIdleCursor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const advance = (ms: number): void => {
    act(() => {
      vi.advanceTimersByTime(ms)
    })
  }

  const move = (type: 'pointermove' | 'pointerdown' = 'pointermove'): void => {
    act(() => {
      window.dispatchEvent(new Event(type))
    })
  }

  it('shows the arrow at first, and hides it after three still seconds', () => {
    const { result } = renderHook(() => useIdleCursor())
    expect(result.current).toBe(false)

    advance(CURSOR_IDLE_MS - 1)
    expect(result.current).toBe(false)

    advance(1)
    expect(result.current).toBe(true)
  })

  it('gives the arrow back at the first movement', () => {
    const { result } = renderHook(() => useIdleCursor())
    advance(CURSOR_IDLE_MS)
    expect(result.current).toBe(true)

    move()

    expect(result.current).toBe(false)
  })

  it('restarts the count at every movement, so a moving mouse keeps it visible', () => {
    const { result } = renderHook(() => useIdleCursor())

    advance(CURSOR_IDLE_MS - 500)
    move()
    advance(CURSOR_IDLE_MS - 500)

    expect(result.current).toBe(false)
    advance(500)
    expect(result.current).toBe(true)
  })

  it('counts a click as a movement', () => {
    const { result } = renderHook(() => useIdleCursor())
    advance(CURSOR_IDLE_MS)

    move('pointerdown')

    expect(result.current).toBe(false)
  })

  it('stops listening and counting once the wall is gone', () => {
    const { unmount } = renderHook(() => useIdleCursor())

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
