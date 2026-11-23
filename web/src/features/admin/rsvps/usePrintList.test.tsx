import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { PRINT_FALLBACK_MS, PRINT_FOCUS_GRACE_MS, usePrintList } from './usePrintList'

/**
 * The printed list must never be left behind (spec 30, lot 2): whatever the browser says or does not
 * say about its print dialog, the sheet with names and diets leaves the page and the button works
 * again.
 */

const PRINTING = 'data-printing-rsvps'

type MediaListener = (event: MediaQueryListEvent) => void

let print: ReturnType<typeof vi.fn>
let mediaListeners: MediaListener[]

beforeEach(() => {
  vi.useFakeTimers()
  print = vi.fn()
  vi.stubGlobal('print', print)
  mediaListeners = []
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: (_type: string, listener: MediaListener) => mediaListeners.push(listener),
      removeEventListener: (_type: string, listener: MediaListener) => {
        mediaListeners = mediaListeners.filter((kept) => kept !== listener)
      },
    })),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.removeAttribute(PRINTING)
})

const start = () => {
  const view = renderHook(() => usePrintList())
  act(() => view.result.current.print())
  act(() => {
    vi.advanceTimersByTime(20)
  })
  return view
}

describe('usePrintList', () => {
  it('marks the page, prints once, and is done at `afterprint`', () => {
    const view = start()

    expect(print).toHaveBeenCalledTimes(1)
    expect(view.result.current.printing).toBe(true)
    expect(document.body).toHaveAttribute(PRINTING)

    act(() => {
      window.dispatchEvent(new Event('afterprint'))
    })

    expect(view.result.current.printing).toBe(false)
    expect(document.body).not.toHaveAttribute(PRINTING)
  })

  it('is done when the print media query turns off, and not when it turns on', () => {
    const view = start()

    act(() => {
      for (const listener of mediaListeners) listener({ matches: true } as MediaQueryListEvent)
    })
    expect(view.result.current.printing).toBe(true)

    act(() => {
      for (const listener of mediaListeners) listener({ matches: false } as MediaQueryListEvent)
    })
    expect(view.result.current.printing).toBe(false)
  })

  it('is done shortly after the window gets its focus back', () => {
    const view = start()

    act(() => {
      window.dispatchEvent(new Event('focus'))
      vi.advanceTimersByTime(PRINT_FOCUS_GRACE_MS - 1)
    })
    expect(view.result.current.printing).toBe(true)

    act(() => {
      vi.advanceTimersByTime(2)
    })
    expect(view.result.current.printing).toBe(false)
    expect(document.body).not.toHaveAttribute(PRINTING)
  })

  it('is done by the last timeout when no signal ever comes', () => {
    const view = start()

    act(() => {
      vi.advanceTimersByTime(PRINT_FALLBACK_MS - 1000)
    })
    expect(view.result.current.printing).toBe(true)

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(view.result.current.printing).toBe(false)
  })

  it('prints again when pressed while a job is stuck: the button never goes dead', () => {
    const view = start()
    expect(print).toHaveBeenCalledTimes(1)

    act(() => view.result.current.print())
    act(() => {
      vi.advanceTimersByTime(20)
    })

    expect(print).toHaveBeenCalledTimes(2)
    expect(view.result.current.printing).toBe(true)
    expect(document.body).toHaveAttribute(PRINTING)
  })

  it('is done at once, and does not print, when the browser cannot', () => {
    vi.stubGlobal('print', undefined)
    const view = start()

    expect(view.result.current.printing).toBe(false)
    expect(document.body).not.toHaveAttribute(PRINTING)
  })

  it('works without matchMedia, and takes everything off when the page goes away', () => {
    vi.stubGlobal('matchMedia', undefined)
    const view = start()
    expect(view.result.current.printing).toBe(true)

    view.unmount()

    expect(document.body).not.toHaveAttribute(PRINTING)
    act(() => {
      window.dispatchEvent(new Event('afterprint'))
    })
  })
})
