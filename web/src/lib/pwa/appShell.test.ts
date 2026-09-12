import { describe, expect, it, vi } from 'vitest'
import {
  CACHE_PREFIX,
  cacheNameFor,
  isShellRequest,
  ownCacheNames,
  respondFromShell,
  staleCacheNames,
} from './appShell'

/**
 * The safety boundary of the only `fetch` handler in this application.
 *
 * A service worker sits in front of every request the page makes. That is what makes one
 * frightening, and it is why most of this file is about what the handler refuses to touch
 * rather than what it answers: every `false` from `isShellRequest` is a request that
 * reaches the network exactly as it would with no worker installed at all.
 */

const ORIGIN = 'https://photos.example'

const aRequest = (url: string, init?: RequestInit): Request => new Request(url, init)

describe('isShellRequest', () => {
  it('answers for a page a guest is navigating to', () => {
    expect(isShellRequest(aRequest(`${ORIGIN}/e/mariage/upload`), ORIGIN)).toBe(true)
  })

  it('answers for the bundle that page needs to boot', () => {
    expect(isShellRequest(aRequest(`${ORIGIN}/assets/index-a1b2c3.js`), ORIGIN)).toBe(true)
  })

  it('never touches the API', () => {
    // Authorization decisions, upload responses and media bytes all live under here, and
    // a cached answer to any of them is a wrong answer — potentially somebody else's.
    expect(isShellRequest(aRequest(`${ORIGIN}/api/events/mariage/photos`), ORIGIN)).toBe(false)
    expect(isShellRequest(aRequest(`${ORIGIN}/api/auth/me`), ORIGIN)).toBe(false)
  })

  it('never touches the live stream', () => {
    // The wall holds this connection open for eight hours. A worker that intercepted it
    // is a worker that can stop photos reaching the room.
    expect(isShellRequest(aRequest(`${ORIGIN}/api/events/mariage/stream`), ORIGIN)).toBe(false)
  })

  it('never touches an upload', () => {
    expect(isShellRequest(aRequest(`${ORIGIN}/e/mariage/upload`, { method: 'POST' }), ORIGIN)).toBe(
      false,
    )
  })

  it('ignores everything that is not a GET', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      expect(isShellRequest(aRequest(`${ORIGIN}/`, { method }), ORIGIN)).toBe(false)
    }
  })

  it('ignores another origin entirely', () => {
    expect(isShellRequest(aRequest('https://elsewhere.example/x.js'), ORIGIN)).toBe(false)
  })

  it('is not fooled by an API-looking path on another origin', () => {
    expect(isShellRequest(aRequest('https://elsewhere.example/api/events'), ORIGIN)).toBe(false)
  })

  it('does not treat a path merely containing /api/ as the API', () => {
    // `/e/api/upload` is a client route for an event whose slug happens to be `api`.
    expect(isShellRequest(aRequest(`${ORIGIN}/e/api/upload`), ORIGIN)).toBe(true)
  })
})

describe('cache housekeeping', () => {
  it('names a cache after the build that filled it', () => {
    expect(cacheNameFor('abc123')).toBe(`${CACHE_PREFIX}abc123`)
  })

  it('sweeps the caches of previous builds and keeps the current one', () => {
    const existing = [`${CACHE_PREFIX}old`, `${CACHE_PREFIX}new`]

    expect(staleCacheNames(existing, `${CACHE_PREFIX}new`)).toEqual([`${CACHE_PREFIX}old`])
  })

  it('never deletes a cache this app did not make', () => {
    // The origin may be shared with something else one day, and deleting a stranger's
    // cache is not this worker's business.
    const existing = [`${CACHE_PREFIX}old`, 'someone-elses-cache']

    expect(staleCacheNames(existing, `${CACHE_PREFIX}new`)).toEqual([`${CACHE_PREFIX}old`])
    expect(ownCacheNames(existing)).toEqual([`${CACHE_PREFIX}old`])
  })
})

describe('respondFromShell', () => {
  it('goes to the network first, so a deploy is never served stale', () => {
    // Cache-first would hand yesterday's bundle to a guest standing in front of a working
    // access point for as long as the cache survived. The cache is a fallback for a
    // network that is not there, not a performance trick.
    const fresh = new Response('fresh')
    const match = vi.fn(async () => new Response('stale'))

    return expect(
      respondFromShell(aRequest(`${ORIGIN}/`), { fetch: async () => fresh, match })
        .then((response) => response.text())
        .then((body) => ({ body, consultedCache: match.mock.calls.length })),
    ).resolves.toEqual({ body: 'fresh', consultedCache: 0 })
  })

  it('falls back to the cached copy when the network is gone', async () => {
    const response = await respondFromShell(aRequest(`${ORIGIN}/assets/index-a1b2c3.js`), {
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
      match: async () => new Response('cached'),
    })

    expect(await response.text()).toBe('cached')
  })

  it('falls back to the app shell for a client route it never cached by name', async () => {
    // `/e/mariage/upload` is a client route the server answers with index.html, so it is
    // not in the cache under its own URL. The shell entry is the right answer for any
    // address inside the app — without this, an installed app opens to the browser's
    // offline page on every route but the start URL.
    const match = vi.fn(async (request: Request) =>
      new URL(request.url).pathname === '/' ? new Response('shell') : undefined,
    )

    const response = await respondFromShell(aRequest(`${ORIGIN}/e/mariage/upload`), {
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
      match,
    })

    expect(await response.text()).toBe('shell')
  })

  it('lets the browser show its own offline page when nothing is cached', async () => {
    // A first visit with no network. A synthesised page this app cannot style is worse
    // than the one the browser already has.
    await expect(
      respondFromShell(aRequest(`${ORIGIN}/`), {
        fetch: async () => {
          throw new TypeError('Failed to fetch')
        },
        match: async () => undefined,
      }),
    ).rejects.toThrow(TypeError)
  })

  it('passes a server error through rather than hiding it behind the cache', async () => {
    // A 500 is an answer. Replacing it with a cached page would make a broken server
    // look like a working one.
    const response = await respondFromShell(aRequest(`${ORIGIN}/`), {
      fetch: async () => new Response('boom', { status: 500 }),
      match: async () => new Response('cached'),
    })

    expect(response.status).toBe(500)
  })
})
