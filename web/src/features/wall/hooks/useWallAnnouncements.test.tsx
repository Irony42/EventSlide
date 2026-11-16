import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aWallAnnouncement } from '../../../testing/renderWithProviders'
import { useWallAnnouncements } from './useWallAnnouncements'

const NOW = Date.parse('2026-11-16T21:00:00.000Z')

describe('useWallAnnouncements', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  const now = () => Date.now()
  const announcements = (atMs: number) => ({
    items: [aWallAnnouncement(atMs)],
    nextReadAtMs: NOW + 900_000,
  })

  it('renders again at each boundary and at no other moment', async () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useWallAnnouncements(announcements(NOW + 400_000), now)
    })
    expect(result.current.active).toBe(false)
    const first = renders

    await act(async () => {
      await vi.advanceTimersByTimeAsync(99_999)
    })
    expect(renders).toBe(first)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(result.current.band?.id).toBe('announcement-1')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000)
    })
    expect(result.current.card?.id).toBe('announcement-1')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(result.current.active).toBe(false)
  })

  it('keeps one timer armed, and none once nothing is left to come or on screen', async () => {
    const { result } = renderHook(() => useWallAnnouncements(announcements(NOW + 400_000), now))
    expect(vi.getTimerCount()).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100_000)
    })
    expect(vi.getTimerCount()).toBe(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000)
    })
    expect(vi.getTimerCount()).toBe(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })

    expect(result.current.active).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears its timer when the page goes away', () => {
    const { unmount } = renderHook(() => useWallAnnouncements(announcements(NOW + 400_000), now))
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('arms nothing without announcements', () => {
    renderHook(() => useWallAnnouncements(undefined, now))

    expect(vi.getTimerCount()).toBe(0)
  })

  it('renders again when the tab comes back to the foreground', () => {
    let renders = 0
    renderHook(() => {
      renders += 1
      return useWallAnnouncements(announcements(NOW + 400_000), now)
    })
    const before = renders

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(renders).toBeGreaterThan(before)
  })

  it('stops listening to the visibility when the page goes away', () => {
    const remove = vi.spyOn(document, 'removeEventListener')
    const { unmount } = renderHook(() => useWallAnnouncements(announcements(NOW + 400_000), now))

    unmount()

    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  })

  it('never asks a timer to wait longer than a timer can', () => {
    const spy = vi.spyOn(window, 'setTimeout')
    renderHook(() => useWallAnnouncements(announcements(NOW + 60 * 24 * 3_600_000), now))

    const delays = spy.mock.calls.map((call) => call[1] ?? 0)
    expect(Math.max(...delays)).toBeLessThanOrEqual(2_147_483_647)
  })
})
