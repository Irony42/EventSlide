import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OUTAGE_DOT_AFTER_MS, OUTAGE_TEXT_AFTER_MS, useOutageStage } from './useOutageStage'

/**
 * What a room is told about a lost connection is a matter of how long it has lasted: a venue
 * network drops for thirty seconds several times an evening and the photos keep turning.
 */
describe('useOutageStage', () => {
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

  it('says nothing while the connection is up', () => {
    const { result } = renderHook(() => useOutageStage(false))

    advance(OUTAGE_TEXT_AFTER_MS * 2)

    expect(result.current).toBe('quiet')
  })

  it('stays quiet for a minute, then shows a dot, then the words', () => {
    const { result } = renderHook(() => useOutageStage(true))

    advance(OUTAGE_DOT_AFTER_MS - 1)
    expect(result.current).toBe('quiet')

    advance(1)
    expect(result.current).toBe('dot')

    advance(OUTAGE_TEXT_AFTER_MS - OUTAGE_DOT_AFTER_MS - 1)
    expect(result.current).toBe('dot')

    advance(1)
    expect(result.current).toBe('text')
  })

  it('goes quiet the moment the connection returns', () => {
    const { result, rerender } = renderHook(({ offline }) => useOutageStage(offline), {
      initialProps: { offline: true },
    })
    advance(OUTAGE_TEXT_AFTER_MS)
    expect(result.current).toBe('text')

    rerender({ offline: false })

    expect(result.current).toBe('quiet')
  })

  it('does not add up the blips of a network that flaps', () => {
    const { result, rerender } = renderHook(({ offline }) => useOutageStage(offline), {
      initialProps: { offline: true },
    })

    for (let blip = 0; blip < 5; blip += 1) {
      advance(OUTAGE_DOT_AFTER_MS - 1_000)
      rerender({ offline: false })
      rerender({ offline: true })
    }

    expect(result.current).toBe('quiet')
  })

  it('leaves no timer behind once the wall is gone', () => {
    const { unmount } = renderHook(() => useOutageStage(true))

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
