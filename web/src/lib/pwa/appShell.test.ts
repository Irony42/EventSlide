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

/**
 * A request the way a browser builds one for a page the user navigates to. `new Request` cannot
 * produce `mode: 'navigate'` (the constructor refuses it), so the real request is wrapped and only
 * that one property is overridden.
 */
const aNavigation = (url: string): Request => {
  const real = new Request(url)
  return new Proxy(real, {
    get(target, property) {
      if (property === 'mode') return 'navigate'
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

const offline = async (): Promise<Response> => {
  throw new TypeError('Failed to fetch')
}

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

  it.each([
    ['a manifest, fetched by the browser without credentials', 'omit', '/manifest.webmanifest'],
    ['a script, fetched without credentials', 'omit', '/assets/index-a1b2c3.js'],
  ] as const)('fetches %s with the same-origin cookies', async (_label, credentials, path) => {
    // WebKit's worker fetches of the shell reached the server without the cookie jar, and the
    // server minted a new `es_csrf` for each, so the token the page read went stale and the
    // next POST was refused twice. The worker says explicitly that the cookies go along.
    const seen: Request[] = []

    await respondFromShell(aRequest(`${ORIGIN}${path}`, { credentials }), {
      fetch: async (input) => {
        seen.push(input as Request)
        return new Response('ok')
      },
      match: async () => undefined,
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]?.credentials).toBe('same-origin')
    expect(seen[0]?.url).toBe(`${ORIGIN}${path}`)
  })

  it('hands a navigation to the network exactly as the browser built it', async () => {
    // A navigation always carries the cookies, and rebuilding it would turn it into a
    // same-origin fetch with a different redirect handling.
    const navigation = aNavigation(`${ORIGIN}/e/mariage/upload`)
    const seen: unknown[] = []

    await respondFromShell(navigation, {
      fetch: async (input) => {
        seen.push(input)
        return new Response('ok')
      },
      match: async () => undefined,
    })

    expect(seen).toEqual([navigation])
    expect(seen[0]).toBe(navigation)
  })

  it('still looks the original request up in the cache when the network is gone', async () => {
    const original = aRequest(`${ORIGIN}/manifest.webmanifest`, { credentials: 'omit' })
    const asked: Request[] = []

    await respondFromShell(original, {
      fetch: offline,
      match: async (request) => {
        asked.push(request)
        return new Response('cached')
      },
    })

    expect(asked[0]).toBe(original)
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

    const response = await respondFromShell(aNavigation(`${ORIGIN}/e/mariage/upload`), {
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
      match,
    })

    expect(await response.text()).toBe('shell')
  })

  it('does not answer an uncached script or stylesheet with the shell document', async () => {
    // A lazy chunk is not in the precache. Answering it with index.html makes the browser
    // report a MIME error ("expected a JavaScript module, got text/html"), which the crash
    // recovery reads as a stale bundle. A plain network failure is the truthful answer.
    const onlyTheShell = async (request: Request) =>
      new URL(request.url).pathname === '/' ? new Response('<html>shell</html>') : undefined

    for (const path of ['/assets/AdminConsole-9f.js', '/assets/app-1.css', '/icons/logo.png']) {
      await expect(
        respondFromShell(aRequest(`${ORIGIN}${path}`), { fetch: offline, match: onlyTheShell }),
      ).rejects.toThrow(TypeError)
    }
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
