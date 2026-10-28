import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { exceedsShare, MAX_SHARE_PROPERTY, useOversizedPane } from './useOversizedPane'
import PAGE_CSS from '../GuestUploadPage.module.css?raw'
import TOKENS_CSS from '../../../design-system/tokens.css?raw'
import DESIGN_SYSTEM_MD from '../../../../../docs/DESIGN-SYSTEM.md?raw'

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
  /** Like the real one, it reports the starting size as soon as it is asked to watch. */
  readonly observe = vi.fn(() => {
    // Real observers report after layout, a moment after the commit that mounted the pane: a
    // test that cares says so, and the rest take the report at once.
    if (reportLate.value) queueMicrotask(() => this.callback())
    else this.callback()
  })
  readonly unobserve = vi.fn()
  constructor(private readonly callback: () => void) {
    observers.push(this)
  }
  /** Like the real one, it only hears of an element it was asked to watch. */
  fire(): void {
    if (this.observe.mock.calls.length > 0) this.callback()
  }
}

const reportLate = { value: false }
const scrollIntoView = vi.fn()

const state = { paneHeight: 0, paneBottom: 0 }

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
      () => ({ height: state.paneHeight, bottom: state.paneBottom }) as DOMRect,
    )
    setViewport(375, 1000)
    setShare('0.5')
    state.paneHeight = 400
    state.paneBottom = 900
    scrollIntoView.mockClear()
    reportLate.value = false
    Element.prototype.scrollIntoView = scrollIntoView
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

  it('takes a pane taller than the share out of the pinned position when it mounts', () => {
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

  it('does not re-decide against a screen that got shorter while the pane itself changed size', () => {
    // A keyboard opening under a caption: the caption grows the pane, and the screen has shrunk.
    render(<Pane />)

    setViewport(375, 600)
    state.paneHeight = 420
    paneChanged()

    expect(isOversized()).toBe(false)
  })

  it('re-decides when the width changes, which is a rotation or a page zoom', () => {
    render(<Pane />)

    setViewport(667, 400)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(isOversized()).toBe(true)
  })

  it('brings the bottom of the pane back into view when it grows past the share below the fold', () => {
    render(<Pane />)

    state.paneHeight = 650
    state.paneBottom = 1500
    paneChanged()

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end' })
  })

  it('does not scroll a pane that is already in view when it leaves the pinned position', () => {
    render(<Pane />)

    state.paneHeight = 650
    state.paneBottom = 950
    paneChanged()

    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('does not scroll a page that opens with a pane that is already too tall', async () => {
    state.paneHeight = 650
    state.paneBottom = 1500
    reportLate.value = true

    await act(async () => {
      render(<Pane />)
    })

    expect(isOversized()).toBe(true)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('does not scroll when the pane gets too tall for a rotation', () => {
    render(<Pane />)

    state.paneBottom = 1500
    setViewport(667, 300)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(isOversized()).toBe(true)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('does not scroll when the pane goes back to being pinned', () => {
    render(<Pane />)
    state.paneHeight = 650
    state.paneBottom = 1500
    paneChanged()
    scrollIntoView.mockClear()

    state.paneHeight = 400
    paneChanged()

    expect(scrollIntoView).not.toHaveBeenCalled()
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

  it('declares a share of at most 70% of the screen for a pinned pane, and the docs say the same', () => {
    const declared = (css: string) =>
      Number(new RegExp(`${MAX_SHARE_PROPERTY}:\\s*([0-9.]+);`).exec(css)?.[1])

    const share = declared(TOKENS_CSS)

    expect(share).toBeGreaterThan(0)
    expect(share).toBeLessThanOrEqual(0.7)
    expect(declared(DESIGN_SYSTEM_MD)).toBe(share)
  })
})
