import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isChunkLoadError,
  pageReload,
  reloadForStaleBundle,
  serverReachable,
  STALE_BUNDLE_MARKER,
  STALE_BUNDLE_WINDOW_MS,
  surfaceOfPath,
} from './crashRecovery'

const NOW = 1_800_000_000_000

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isChunkLoadError', () => {
  it.each([
    ['Chrome', 'Failed to fetch dynamically imported module: /assets/DashboardPage-3f9a2c.js'],
    ['Firefox', 'error loading dynamically imported module'],
    ['Safari', 'Importing a module script failed.'],
    [
      'a host that answers the old address with index.html',
      'Failed to load module script: Expected a JavaScript module script',
    ],
    [
      'Vite, for a stylesheet that is gone',
      'Unable to preload CSS for /assets/WallPage-8c1d04.css',
    ],
    ['a webpack-style loader', 'Loading chunk 7 failed.'],
  ])('recognises the way %s says a chunk did not arrive', (_engine, message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true)
  })

  it('recognises a ChunkLoadError by its name', () => {
    const error = new Error('whatever the loader said')
    error.name = 'ChunkLoadError'

    expect(isChunkLoadError(error)).toBe(true)
  })

  it('does not take an ordinary render error for a stale bundle', () => {
    expect(
      isChunkLoadError(new Error("Cannot read properties of undefined (reading 'name')")),
    ).toBe(false)
  })
})

describe('reloadForStaleBundle', () => {
  it('reloads the page the first time, and records when', () => {
    const reload = vi.spyOn(pageReload, 'reload').mockImplementation(() => {})

    expect(reloadForStaleBundle(NOW)).toBe(true)

    expect(reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(STALE_BUNDLE_MARKER)).toBe(String(NOW))
  })

  it('does not reload a second time inside the window, so a broken build cannot loop', () => {
    const reload = vi.spyOn(pageReload, 'reload').mockImplementation(() => {})
    reloadForStaleBundle(NOW)
    reload.mockClear()

    expect(reloadForStaleBundle(NOW + STALE_BUNDLE_WINDOW_MS - 1)).toBe(false)

    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads again once the window has passed', () => {
    const reload = vi.spyOn(pageReload, 'reload').mockImplementation(() => {})
    reloadForStaleBundle(NOW)
    reload.mockClear()

    expect(reloadForStaleBundle(NOW + STALE_BUNDLE_WINDOW_MS)).toBe(true)

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('treats a marker from the future (a clock that moved back) as no guard', () => {
    const reload = vi.spyOn(pageReload, 'reload').mockImplementation(() => {})
    sessionStorage.setItem(STALE_BUNDLE_MARKER, String(NOW + 5_000))

    expect(reloadForStaleBundle(NOW)).toBe(true)

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the browser says it is offline, where a reload is a worse page', () => {
    const reload = vi.spyOn(pageReload, 'reload').mockImplementation(() => {})
    vi.stubGlobal('navigator', { ...navigator, onLine: false })

    expect(reloadForStaleBundle(NOW)).toBe(false)

    expect(reload).not.toHaveBeenCalled()
  })

  it('does nothing when it cannot write its marker, because it could not stop a loop', () => {
    const reload = vi.spyOn(pageReload, 'reload').mockImplementation(() => {})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    expect(reloadForStaleBundle(NOW)).toBe(false)

    expect(reload).not.toHaveBeenCalled()
  })
})

describe('surfaceOfPath', () => {
  it.each([
    ['/e/camille-et-sacha/display', 'wall'],
    ['/admin', 'host'],
    ['/admin/events/mariage/moderation', 'host'],
    ['/login', 'host'],
    ['/invite/abc123', 'host'],
    ['/password/reset/abc123', 'host'],
    ['/join/H7K2QM', 'guest'],
    ['/e/camille-et-sacha/upload', 'guest'],
    ['/', 'guest'],
  ] as const)('puts %s on the %s surface', (path, surface) => {
    expect(surfaceOfPath(path)).toBe(surface)
  })
})

describe('serverReachable', () => {
  it('is true when the server answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    )

    expect(await serverReachable()).toBe(true)
  })

  it('is false when the server answers with a failure, as a proxy does with nothing behind it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 502 })),
    )

    expect(await serverReachable()).toBe(false)
  })

  it('is false when the request cannot be made at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    )

    expect(await serverReachable()).toBe(false)
  })
})
