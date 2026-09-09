import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeAll, vi } from 'vitest'

/**
 * jsdom setup shared by every component test.
 *
 * Everything here stands in for a browser API jsdom does not implement. Nothing here
 * stubs application code: a component test that needs a fake API passes one through
 * `renderWithProviders`, so the component under test stays real.
 *
 * The casts below are the one place in the web app where a structural cast is
 * unavoidable — a hand-written stub cannot satisfy a full DOM interface, and the
 * alternative is pulling in a polyfill package for four no-op classes.
 */

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeAll(() => {
  // The design system reads prefers-reduced-motion and the wall reads
  // prefers-color-scheme. jsdom ships no matchMedia at all.
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }

  // The upload queue creates object URLs for local previews and revokes them on
  // unmount; jsdom implements neither.
  if (typeof URL.createObjectURL !== 'function') {
    let counter = 0
    URL.createObjectURL = () => `blob:eventslide/${(counter += 1)}`
    URL.revokeObjectURL = () => {}
  }

  // The moderation grid and the mosaic wall lazy-load thumbnails.
  if (typeof window.IntersectionObserver !== 'function') {
    class StubIntersectionObserver {
      readonly root = null
      readonly rootMargin = ''
      readonly scrollMargin = ''
      readonly thresholds: readonly number[] = []
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return []
      }
    }
    window.IntersectionObserver =
      StubIntersectionObserver as unknown as typeof window.IntersectionObserver
  }

  // The wall measures itself to lay out the mosaic.
  if (typeof window.ResizeObserver !== 'function') {
    class StubResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    window.ResizeObserver = StubResizeObserver as unknown as typeof window.ResizeObserver
  }

  // Real-time updates arrive over SSE. Component tests drive the stream through the
  // fake transport rather than opening a connection, so a bare constructor is enough
  // to keep the hook from throwing.
  if (typeof window.EventSource !== 'function') {
    class StubEventSource {
      readonly url = ''
      readonly readyState = 0
      readonly withCredentials = false
      onopen = null
      onmessage = null
      onerror = null
      close(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
      dispatchEvent(): boolean {
        return false
      }
    }
    window.EventSource = StubEventSource as unknown as typeof window.EventSource
  }

  // The projected wall requests fullscreen when a host presses F.
  if (typeof document.documentElement.requestFullscreen !== 'function') {
    document.documentElement.requestFullscreen = () => Promise.resolve()
    document.exitFullscreen = () => Promise.resolve()
  }
})
