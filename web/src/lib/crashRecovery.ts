/**
 * What the crash screen does to get a screen back on its own: the stale-bundle reload and the
 * wall's timed retry (navigation pass, batch B, finding A4).
 *
 * Kept apart from `ErrorBoundary.tsx` because a `.tsx` file that exports a component and a
 * constant breaks Fast Refresh, and because the rules here are plain functions a test can drive
 * with a clock.
 */

/**
 * How long the wall waits before it tries again after a crash.
 *
 * The wall runs unattended on a projector, so a crash that waits for someone to press
 * "Réessayer" is a black rectangle for the rest of the party. Long enough that a render that
 * fails at once does not flicker the room, short enough that nobody in it notices a hiccup.
 */
export const WALL_RETRY_DELAY_MS = 15_000

/**
 * The browser's own words for "that script file did not load", one per engine.
 *
 * - Chrome: `Failed to fetch dynamically imported module: …`
 * - Firefox: `error loading dynamically imported module`
 * - Safari: `Importing a module script failed.`
 * - Chrome again, when a deploy removed the file and the host answers the old address with
 *   `index.html`: `Failed to load module script: Expected a JavaScript module script…`
 * - webpack-style loaders, in case a dependency brings one: `ChunkLoadError`, `Loading chunk 3 failed`.
 */
const CHUNK_FAILURE = [
  /dynamically imported module/i,
  /importing a module script failed/i,
  /failed to load module script/i,
  // Vite's own wrapper, thrown when a stale tab's stylesheet is gone before its script is tried.
  /unable to preload/i,
  /loading (css )?chunk \S+ failed/i,
]

/**
 * Whether a render error is a lazy chunk that did not arrive.
 *
 * The cause is nearly always a deploy: the tab was opened against the old build, the hashed
 * file it asks for is gone. `React.lazy` remembers a rejected import for the life of the page,
 * so rendering the same tree again re-throws the same error. Only a new document recovers.
 */
export const isChunkLoadError = (error: Error): boolean =>
  error.name === 'ChunkLoadError' || CHUNK_FAILURE.some((pattern) => pattern.test(error.message))

/**
 * The `sessionStorage` key holding the time of the last reload this module asked for.
 * Exported as a test seam (the tests read and seed the marker); no other module imports it.
 */
export const STALE_BUNDLE_MARKER = 'eventslide.staleBundleReload'

/**
 * How long a reload counts as "just happened".
 *
 * A reload that cured the problem never meets the marker again; one that did not (the new
 * build is broken too, or the server is down) must not turn into a reload loop, so a second
 * chunk failure inside this window shows the crash screen instead. Exported as a test seam.
 */
export const STALE_BUNDLE_WINDOW_MS = 60_000

/**
 * The one place the page is reloaded from, so a test can see it happen.
 *
 * `window.location.reload` cannot be replaced in jsdom, and a component test must not rely on
 * a "not implemented" console error to mean anything.
 */
export const pageReload = {
  reload: (): void => {
    window.location.reload()
  },
}

/**
 * How long a "the user is leaving" signal holds when nothing follows it.
 *
 * `beforeunload` also fires for a "leave this page?" prompt answered with "stay", and then no
 * `pagehide` and no `pageshow` ever comes, so the flag must expire by itself.
 */
export const LEAVING_WINDOW_MS = 3_000

let leaving = false
let leavingTimer: ReturnType<typeof setTimeout> | null = null

const stopLeaving = (): void => {
  leaving = false
  if (leavingTimer !== null) clearTimeout(leavingTimer)
  leavingTimer = null
}

const startLeaving = (): void => {
  stopLeaving()
  leaving = true
  leavingTimer = setTimeout(stopLeaving, LEAVING_WINDOW_MS)
}

/**
 * A navigation cancels the requests of the page it leaves, and Vite reports a cancelled lazy
 * stylesheet as "Unable to preload CSS", which looks exactly like a stale bundle. Reloading
 * then would reload the OLD address over the navigation the user just made.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', startLeaving)
  window.addEventListener('pagehide', startLeaving)
  // A page restored from the back/forward cache is alive again.
  window.addEventListener('pageshow', stopLeaving)
}

/**
 * Reloads the page once for a stale bundle, unless it already did a moment ago.
 *
 * Returns whether a reload was started. It is deliberately conservative: it does nothing when
 * `sessionStorage` cannot be written (no marker means no loop guard), and nothing when the
 * browser says it is offline (a reload would swap the crash screen for the browser's own error
 * page, which is worse), and nothing while the user is leaving the page (see above).
 *
 * `startedAtHref` is the address the failing load started at. An in-app navigation fires no unload
 * event, yet it can cancel a lazy preload just the same; when the address has moved on since, the
 * user is already somewhere else and reloading would only throw that away, so nothing is done.
 */
export const reloadForStaleBundle = (now: number = Date.now(), startedAtHref?: string): boolean => {
  if (leaving) return false
  if (
    startedAtHref !== undefined &&
    typeof window !== 'undefined' &&
    window.location.href !== startedAtHref
  ) {
    return false
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  try {
    const previous = Number(sessionStorage.getItem(STALE_BUNDLE_MARKER))
    const elapsed = now - previous
    if (
      Number.isFinite(previous) &&
      previous > 0 &&
      elapsed >= 0 &&
      elapsed < STALE_BUNDLE_WINDOW_MS
    ) {
      return false
    }
    sessionStorage.setItem(STALE_BUNDLE_MARKER, String(now))
  } catch {
    return false
  }
  pageReload.reload()
  return true
}

/** Which audience an address belongs to, for a crash screen that sits above the router. */
export type CrashSurface = 'guest' | 'host' | 'wall'

/**
 * The audience of an address.
 *
 * The layouts say which surface they are; this is for the one boundary that is not inside a
 * layout (`main.tsx`), which still has to know whether to offer the host's home, or nothing at
 * all on a projector.
 */
export const surfaceOfPath = (pathname: string): CrashSurface => {
  if (/^\/e\/[^/]+\/display\/?$/.test(pathname)) return 'wall'
  // `HostLayout`'s addresses: the console, the sign-in, and the pages a link opens.
  if (
    pathname === '/login' ||
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname.startsWith('/invite/') ||
    pathname.startsWith('/password/')
  ) {
    return 'host'
  }
  return 'guest'
}

/**
 * Whether the server answers at all, asked with a request that costs nothing.
 *
 * The wall's timed retry asks it before reloading: a reload while the venue's network is down
 * swaps the crash screen for the browser's own error page, which runs no script and so never
 * recovers. `navigator.onLine` cannot say it, because a LAN with no route to the server still
 * reports online.
 */
export const serverReachable = async (): Promise<boolean> => {
  try {
    const response = await fetch('/', { method: 'HEAD', cache: 'no-store' })
    return response.ok
  } catch {
    return false
  }
}
