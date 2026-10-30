import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWakeLock, WAKE_LOCK_RETRY_MS } from './useWakeLock'

/**
 * The projector's laptop goes to sleep after ten idle minutes unless the page asks the
 * browser not to let it. The browser can say no in three ways (no API, a refusal, a release
 * it makes itself when the tab is hidden), and the shortcuts panel only tells the host to
 * switch sleep off when the screen is not being held.
 */

class Sentinel extends EventTarget {
  released = false

  async release(): Promise<void> {
    this.released = true
    this.dispatchEvent(new Event('release'))
  }
}

const install = (request: () => Promise<unknown>): void => {
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
}

const visibility = (state: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

describe('useWakeLock', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'wakeLock')
    Reflect.deleteProperty(document, 'visibilityState')
  })

  it('holds the screen awake once the browser grants the lock', async () => {
    const request = vi.fn(async () => new Sentinel())
    install(request)

    const { result } = renderHook(() => useWakeLock())

    await waitFor(() => expect(result.current).toBe(true))
    expect(request).toHaveBeenCalledWith('screen')
  })

  it('reports nothing held in a browser that has no Wake Lock API', () => {
    const { result } = renderHook(() => useWakeLock())

    expect(result.current).toBe(false)
  })

  it('reports nothing held when the browser refuses', async () => {
    const request = vi.fn(async () => {
      throw new Error('NotAllowedError')
    })
    install(request)

    const { result } = renderHook(() => useWakeLock())

    await waitFor(() => expect(request).toHaveBeenCalled())
    expect(result.current).toBe(false)
  })

  it('asks again when the tab becomes visible after the browser released the lock', async () => {
    const first = new Sentinel()
    const second = new Sentinel()
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    install(request)
    const { result } = renderHook(() => useWakeLock())
    await waitFor(() => expect(result.current).toBe(true))

    // The browser lets go every time the tab is hidden.
    visibility('hidden')
    await act(async () => {
      await first.release()
    })
    expect(result.current).toBe(false)

    visibility('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await waitFor(() => expect(result.current).toBe(true))
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does not ask while the tab is hidden, which the browser would refuse', async () => {
    visibility('hidden')
    const request = vi.fn(async () => new Sentinel())
    install(request)

    renderHook(() => useWakeLock())
    await act(async () => {
      await Promise.resolve()
    })

    expect(request).not.toHaveBeenCalled()
  })

  it('lets the lock go when the wall is closed', async () => {
    const sentinel = new Sentinel()
    install(vi.fn(async () => sentinel))
    const { result, unmount } = renderHook(() => useWakeLock())
    await waitFor(() => expect(result.current).toBe(true))

    unmount()

    expect(sentinel.released).toBe(true)
  })

  it('releases a lock that was granted after the wall had already gone', async () => {
    const sentinel = new Sentinel()
    let grant: (value: Sentinel) => void = () => undefined
    install(
      vi.fn(
        () =>
          new Promise<Sentinel>((resolve) => {
            grant = resolve
          }),
      ),
    )
    const { unmount } = renderHook(() => useWakeLock())

    unmount()
    await act(async () => {
      grant(sentinel)
      await Promise.resolve()
    })

    expect(sentinel.released).toBe(true)
  })
})

/**
 * The lock is lost in ways that fire no `visibilitychange`: the operating system revokes it on a
 * low battery, a request fails once and would succeed a minute later. A wall that only asked on
 * visibility would then sleep through the rest of the night.
 */
describe('useWakeLock retry while visible', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(navigator, 'wakeLock')
    Reflect.deleteProperty(document, 'visibilityState')
  })

  const afterMs = async (ms: number): Promise<void> => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  it('asks again when the lock is released while the tab is still visible', async () => {
    const first = new Sentinel()
    const second = new Sentinel()
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    install(request)
    const { result } = renderHook(() => useWakeLock())
    await afterMs(0)
    expect(result.current).toBe(true)

    // The system revokes it (battery saver); the tab never stopped being visible.
    await act(async () => {
      await first.release()
    })
    expect(result.current).toBe(false)
    expect(request).toHaveBeenCalledTimes(1)

    await afterMs(WAKE_LOCK_RETRY_MS)

    expect(request).toHaveBeenCalledTimes(2)
    expect(result.current).toBe(true)
  })

  it('asks again after a refusal at mount', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('NotAllowedError'))
      .mockResolvedValueOnce(new Sentinel())
    install(request)
    const { result } = renderHook(() => useWakeLock())
    await afterMs(0)
    expect(result.current).toBe(false)

    await afterMs(WAKE_LOCK_RETRY_MS)

    expect(result.current).toBe(true)
  })

  it('does not hammer a browser that always refuses', async () => {
    const request = vi.fn(async () => {
      throw new Error('NotAllowedError')
    })
    install(request)
    renderHook(() => useWakeLock())

    await afterMs(10 * WAKE_LOCK_RETRY_MS)

    // The first ask at mount, then one a minute.
    expect(request).toHaveBeenCalledTimes(11)
  })

  it('does not ask on the slow timer while the tab is hidden', async () => {
    visibility('hidden')
    const request = vi.fn(async () => new Sentinel())
    install(request)
    renderHook(() => useWakeLock())

    await afterMs(5 * WAKE_LOCK_RETRY_MS)

    expect(request).not.toHaveBeenCalled()
  })

  it('leaves no timer behind once the wall is gone', async () => {
    install(vi.fn(async () => new Sentinel()))
    const { unmount } = renderHook(() => useWakeLock())
    await afterMs(0)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
