/**
 * The app shell, cached so an installed EventSlide opens with no connection.
 *
 * Two things needed this, and the second is not obvious. The visible reason is that an
 * installed app which shows the browser's offline page is not much of an installed app.
 * The other is that Chromium's algorithm for firing `beforeinstallprompt` still requires
 * a service worker with a `fetch` handler, even though the *menu* install no longer does
 * — so without one there is no install offer to make on the only platform with an API
 * for making one.
 *
 * Chrome's own account of relaxing that rule is that sites gamed it with empty
 * pass-through `fetch` handlers, and that those handlers hurt performance. So this one
 * does real work or gets out of the way entirely: {@link isShellRequest} answers `false`
 * for everything but the app shell, and the worker then returns without calling
 * `respondWith`, which leaves the request on the browser's own fast path as though no
 * worker were installed.
 *
 * Nothing here touches a global. The worker owns `caches` and `fetch` and passes them in,
 * which is what lets the whole safety boundary be tested at ring 5 — `web/sw/` belongs to
 * no vitest project, so logic written there reports as nothing in the coverage summary.
 */

/** Every cache name this worker has ever used, so old builds can be swept. */
export const CACHE_PREFIX = 'eventslide-shell-'

export const cacheNameFor = (version: string): string => `${CACHE_PREFIX}${version}`

/**
 * Whether this request is one the shell cache has any business answering.
 *
 * Separately tested because it is the safety boundary: every `false` is a request that
 * reaches the network exactly as it would with no worker installed at all.
 */
export const isShellRequest = (request: Request, origin: string): boolean => {
  if (request.method !== 'GET') return false

  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return false
  }

  if (url.origin !== origin) return false
  // The API is never cached and never intercepted. Authorization decisions, upload
  // responses, media bytes and an eight-hour SSE connection all live under here, and a
  // cached answer to any of them is a wrong answer.
  if (url.pathname.startsWith('/api/')) return false
  return true
}

/** The caches to delete: everything this worker made except the one in use. */
export const staleCacheNames = (existing: readonly string[], keep: string): readonly string[] =>
  existing.filter((name) => name.startsWith(CACHE_PREFIX) && name !== keep)

/** Every cache this worker ever made. The kill switch's other half. */
export const ownCacheNames = (existing: readonly string[]): readonly string[] =>
  existing.filter((name) => name.startsWith(CACHE_PREFIX))

export interface ShellHandlerOptions {
  readonly fetch: typeof fetch
  readonly match: (request: Request) => Promise<Response | undefined>
}

/**
 * Answers one shell request.
 *
 * Network first, cache second, and never the other way round. Cache-first would serve
 * yesterday's bundle to a guest standing in front of a working access point for as long
 * as the cache survived, which is the classic way a service worker turns a deploy into a
 * support ticket. The cache is a fallback for a network that is not there, not a
 * performance trick.
 *
 * A navigation that fails falls back to the cached document rather than to nothing:
 * `/e/:slug/upload` is a client route the server answers with `index.html`, so the shell
 * entry is the right answer for any address inside the app.
 */
export const respondFromShell = async (
  request: Request,
  { fetch, match }: ShellHandlerOptions,
): Promise<Response> => {
  try {
    return await fetch(request)
  } catch (cause) {
    // The shell's URL is resolved against the request rather than written as `'/'`. A
    // bare relative URL only resolves inside a worker, where there is a `location` to
    // resolve it against, so the plain form threw everywhere else — including in every
    // test of this function, which is how it was found.
    const shell = new Request(new URL('/', request.url).href)
    const cached = (await match(request)) ?? (await match(shell))
    if (cached !== undefined) return cached
    // Nothing cached and no network. Rethrowing gives the browser its own offline page,
    // which is a better answer than a synthesised one this app cannot style anyway.
    throw cause
  }
}
