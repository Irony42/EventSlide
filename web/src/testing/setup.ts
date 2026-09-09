import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeAll, vi } from 'vitest'

/**
 * jsdom setup shared by every component test.
 *
 * Everything stubbed here is a browser API jsdom does not implement. Nothing in this
 * file stubs application code — a component test that needs a fake API talks to the
 * fake transport in `renderWithProviders`, so the component under test stays real.
 */

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeAll(() => {
  // The design system reads prefers-reduced-motion and the wall reads
  // prefers-color-scheme. jsdom ships no matchMedia at all.
  if (!window.matchMedia) {
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList
  }

  // The upload queue creates object URLs for local previews and revokes them on
  // unmount; jsdom implements neither.
  if (!URL.createObjectURL) {
    let counter = 0
    URL.createObjectURL = () => `blob:eventslide/${++counter}`
    URL.revokeObjectURL = () => {}
  }

  // The moderation grid and the mosaic wall lazy-load thumbnails.
  if (!('IntersectionObserver' in window)) {
    class NoopIntersectionObserver implements IntersectionObserver {
      readonly root = null
      readonly rootMargin = ''
      readonly thresholds: readonly number[] = []
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return []
      }
    }
    window.IntersectionObserver = NoopIntersectionObserver as unknown as typeof IntersectionObserver
  }

  // The wall measures itself to lay out the mosaic.
  if (!('ResizeObserver' in window)) {
    class NoopResizeObserver implements ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    window.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver
  }

  // Real-time updates arrive over SSE. Component tests drive the stream through the
  // fake transport rather than opening a connection, so a bare constructor is enough
  // to keep the hook from throwing.
  if (!('EventSource' in window)) {
    class NoopEventSource {
      close(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    }
    window.EventSource = NoopEventSource as unknown as typeof EventSource
  }
})
