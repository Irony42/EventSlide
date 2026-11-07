import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePollWhile } from './usePollWhile'

const setVisibility = (state: 'visible' | 'hidden'): void => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

describe('usePollWhile', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(document, 'visibilityState')
  })

  it('ticks once per interval while active and visible', () => {
    const tick = vi.fn()
    renderHook(() => usePollWhile(true, 1_000, tick))

    vi.advanceTimersByTime(3_000)

    expect(tick).toHaveBeenCalledTimes(3)
  })

  it('never ticks while inactive', () => {
    const tick = vi.fn()
    renderHook(() => usePollWhile(false, 1_000, tick))

    vi.advanceTimersByTime(5_000)

    expect(tick).not.toHaveBeenCalled()
  })

  it('skips the beats while the page is hidden, and resumes when it is visible (WEB-HOST-13)', () => {
    const tick = vi.fn()
    renderHook(() => usePollWhile(true, 1_000, tick))
    setVisibility('hidden')

    vi.advanceTimersByTime(3_000)
    expect(tick).not.toHaveBeenCalled()

    setVisibility('visible')
    vi.advanceTimersByTime(1_000)
    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('stops ticking once it goes inactive', () => {
    const tick = vi.fn()
    const { rerender } = renderHook(({ active }) => usePollWhile(active, 1_000, tick), {
      initialProps: { active: true },
    })
    vi.advanceTimersByTime(1_000)

    rerender({ active: false })
    vi.advanceTimersByTime(5_000)

    expect(tick).toHaveBeenCalledTimes(1)
  })
})
