import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, beforeAll, vi } from 'vitest'
import { forgetMemoryFallback } from '../lib/offline/openOutbox'

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

/**
 * How long `findBy*` and `waitFor` wait before they give up. Testing Library's default is
 * 1000 ms, which a *passing* test can exceed: the router tests render pages that are
 * `lazy()` chunks, and the first test of a cold worker pays to transform and import the
 * chunk (about 1030 ms locally, more on a loaded 2-core runner; the flake of #330). 5 s is
 * five times that cost and half of the 10 s `testTimeout`, so a real failure still reports
 * Testing Library's own message and DOM dump, not a bare test timeout. A passing wait
 * returns as soon as it can: this only lengthens how long a failure takes to show.
 */
configure({ asyncUtilTimeout: 5_000 })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  // jsdom has no IndexedDB, so every screen that opens the outbox gets the page's memory store, and
  // that store now outlives the screen. One per test, or a photo queued by one test would be
  // drained by the next.
  forgetMemoryFallback()
  // jsdom keeps one `localStorage` and one `sessionStorage` for a whole file, so what one
  // test writes would otherwise leak into every test after it: a test that picks a
  // language would decide the starting language of the next, and a guest session or the
  // stale-bundle marker (both live in `sessionStorage`) would be found by a test that
  // expects a fresh visitor. Clearing all of it is the rule that stays true when
  // something else is added.
  for (const area of ['localStorage', 'sessionStorage'] as const) {
    try {
      window[area].clear()
    } catch {
      // A browser with site data blocked throws. Nothing to clean up in that case.
    }
  }
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
  // unmount. Replaced unconditionally: jsdom 30.1 ships its own, which throws on the
  // File objects these tests build ("Cannot read properties of undefined (reading
  // '_buffer')"), so a "polyfill only if missing" guard now skips the stub and every
  // upload test fails.
  let counter = 0
  URL.createObjectURL = () => `blob:eventslide/${(counter += 1)}`
  URL.revokeObjectURL = () => {}

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
