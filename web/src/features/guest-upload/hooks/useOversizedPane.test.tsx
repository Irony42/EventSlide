import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { exceedsShare, MAX_SHARE_PROPERTY, useOversizedPane } from './useOversizedPane'
import PAGE_CSS from '../GuestUploadPage.module.css?raw'
import TOKENS_CSS from '../../../design-system/tokens.css?raw'

/**
 * What decides whether the guest's upload pane stays pinned to the bottom of the screen.
 *
 * jsdom has no layout, so the two numbers the rule needs — the pane's height and the
 * viewport's — are set by hand, and a ResizeObserver stands in for the one that tells the
 * hook the pane has grown. The real answer, in a real browser, is `guest-upload-pane.spec.ts`.
 */

/** The observers the hook created, so a test can say "the pane just changed size". */
const observers: FakeResizeObserver[] = []

class FakeResizeObserver {
  readonly disconnect = vi.fn()
  readonly observe = vi.fn()
  readonly unobserve = vi.fn()
  constructor(private readonly callback: () => void) {
    observers.push(this)
  }
  /** Like the real one, it only hears of an element it was asked to watch. */
  fire(): void {
    if (this.observe.mock.calls.length > 0) this.callback()
  }
}

const state = { paneHeight: 0 }

const setViewport = (width: number, height: number): void => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

/** The pane changed size (or the page did): every observer the hook holds hears of it. */
const paneChanged = (): void => {
  act(() => {
    for (const observer of observers) observer.fire()
  })
}

const setShare = (share: string | null): void => {
  if (share === null) document.documentElement.style.removeProperty(MAX_SHARE_PROPERTY)
  else document.documentElement.style.setProperty(MAX_SHARE_PROPERTY, share)
}

function Pane() {
  const ref = useRef<HTMLDivElement | null>(null)
  const oversized = useOversizedPane(ref)
  return <div ref={ref} data-testid="pane" data-oversized={oversized ? '' : undefined} />
}

const isOversized = (): boolean => screen.getByTestId('pane').hasAttribute('data-oversized')

describe('exceedsShare', () => {
  it('allows a pane of exactly the share, and refuses one pixel more', () => {
    expect(exceedsShare(500, 1000, 0.5)).toBe(false)
    expect(exceedsShare(501, 1000, 0.5)).toBe(true)
  })

  it('never calls a pane too tall for a viewport it cannot measure', () => {
    expect(exceedsShare(500, 0, 0.5)).toBe(false)
  })
})

describe('useOversizedPane', () => {
  beforeEach(() => {
    observers.length = 0
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ height: state.paneHeight }) as DOMRect,
    )
    setViewport(375, 1000)
    setShare('0.5')
    state.paneHeight = 400
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    setShare(null)
  })

  it('leaves a pane that fits the screen pinned', () => {
    render(<Pane />)

    expect(isOversized()).toBe(false)
  })

  it('takes a pane taller than the share out of the pinned position as soon as it is on screen', () => {
    state.paneHeight = 501

    render(<Pane />)

    expect(isOversized()).toBe(true)
  })

  it('keeps a pane of exactly the share pinned', () => {
    state.paneHeight = 500

    render(<Pane />)

    expect(isOversized()).toBe(false)
  })

  it('follows the pane as it grows with every photo the guest picks, and as it shrinks again', () => {
    render(<Pane />)

    state.paneHeight = 650
    paneChanged()
    expect(isOversized()).toBe(true)

    state.paneHeight = 400
    paneChanged()
    expect(isOversized()).toBe(false)
  })

  it('does not re-decide when only the height of the screen changes', () => {
    // An address bar sliding away, or a keyboard opening under a caption being typed.
    render(<Pane />)

    setViewport(375, 600)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(isOversized()).toBe(false)
  })

  it('re-decides when the width changes, which is a rotation or a change of text size', () => {
    render(<Pane />)

    setViewport(667, 400)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(isOversized()).toBe(true)
  })

  it('leaves the pane pinned when no share is declared', () => {
    setShare(null)
    state.paneHeight = 5000

    render(<Pane />)

    expect(isOversized()).toBe(false)
  })

  it('stops listening once the pane is gone', () => {
    const removed = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(<Pane />)
    const [observer] = observers

    unmount()

    expect(observer?.disconnect).toHaveBeenCalled()
    expect(removed).toHaveBeenCalledWith('resize', expect.any(Function))
  })
})

describe('what the stylesheets say about it', () => {
  it('takes the pane out of the pinned position while it is oversized', () => {
    const rule = /\.composer\[data-oversized\]\s*\{([^}]*)\}/.exec(PAGE_CSS)

    expect(rule?.[1]).toMatch(/position:\s*static/)
  })

  it('declares the share the hook reads, as a ratio of the viewport', () => {
    const declared = new RegExp(`${MAX_SHARE_PROPERTY}:\\s*([0-9.]+);`).exec(TOKENS_CSS)

    const share = Number(declared?.[1])
    expect(share).toBeGreaterThan(0)
    expect(share).toBeLessThan(1)
  })
})
