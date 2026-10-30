import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWakeLock } from './useWakeLock'

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
