import { drainOutbox } from '../src/lib/offline/drainOutbox'
import { fetchOutboxSender } from '../src/lib/offline/fetchSender'
import { IndexedDbOutbox } from '../src/lib/offline/indexedDbOutbox'
import {
  CSRF_COOKIE,
  KILL_MESSAGE,
  OUTBOX_SYNC_TAG,
  PUSH_ONLY_MESSAGE,
  QUEUE_ON_MESSAGE,
} from '../src/lib/offline/names'
import { readPushOnly, writePushOnly } from '../src/lib/push/pushOnlyMode'
import {
  noticeText,
  notificationTag,
  openRepliesPage,
  parseRsvpNotice,
  repliesPath,
  type OpenWindow,
} from '../src/lib/push/pushNotice'
import {
  cacheNameFor,
  isShellRequest,
  ownCacheNames,
  respondFromShell,
  staleCacheNames,
} from '../src/lib/pwa/appShell'
import type { OutboxStore } from '../src/lib/offline/outbox'

/**
 * The upload worker.
 *
 * Two jobs, both narrow. It finishes sending photos the guest is no longer watching,
 * and it answers for the app shell when the network will not — which is what lets an
 * installed EventSlide open at all with no connection, and what makes Chromium willing
 * to fire `beforeinstallprompt` in the first place.
 *
 * Everything else is left alone. `isShellRequest` refuses anything that is not a
 * same-origin GET outside `/api/`, and the handler then returns without calling
 * `respondWith`, so uploads, media, authorization and the eight-hour SSE connection take
 * the same path they would with no worker installed. The shell answer is network-first,
 * so a deploy is never served stale to a guest who has a working access point.
 *
 * It is deliberately thin, and that is a testing decision rather than a taste one. This
 * file is built as its own bundle (`web/vite.sw.config.ts` to `dist/client/sw.js`) and
 * belongs to no vitest project, so anything written here is invisible to the coverage
 * report — not a low number, *absent*, which is the one way a gap stays hidden. The
 * store, the drain and the sender are all ordinary `web/src` modules with ring-5 tests;
 * what is left below is wiring, and the end-to-end suite covers that.
 *
 * It is type-checked as its own program (`tsconfig.sw.json`) because a worker global
 * scope and a DOM global scope cannot coexist in one TypeScript program.
 */

/** Written by the build; see `injectPrecache` in web/vite.sw.config.ts. */
declare const __PRECACHE_URLS__: readonly string[]
declare const __PRECACHE_VERSION__: string

const CACHE_NAME = cacheNameFor(__PRECACHE_VERSION__)

/** `sync` is a Background Sync addition TypeScript's worker library does not declare. */
interface SyncEvent extends ExtendableEvent {
  readonly tag: string
}

/**
 * `self` inside a service worker really is a `ServiceWorkerGlobalScope`, but the worker
 * library types it as the base `WorkerGlobalScope` — the same declaration serves
 * dedicated and shared workers — so this narrowing is unavoidable. It is the one cast in
 * the file, it is to a real interface rather than to `any`, and it is wrong only if this
 * bundle is loaded as something other than a service worker.
 */
const worker = self as unknown as ServiceWorkerGlobalScope

/**
 * Whether this worker is in push-only mode: the offline queue is switched off while a browser
 * notification is still subscribed, so the registration stays (the subscription lives on it) but the
 * worker serves neither the shell nor the outbox. **Kept in the Cache Storage** (`pushOnlyMode.ts`) and
 * read again whenever the browser starts this worker; a promise, so that every handler waits for the
 * stored answer before deciding. The page says it again whenever it changes (`PUSH_ONLY_MESSAGE`,
 * `QUEUE_ON_MESSAGE`).
 */
let pushOnly: Promise<boolean> = readPushOnly(caches)

/**
 * The live CSRF token.
 *
 * A worker has no `document.cookie`. `cookieStore` is the worker-side reader and exists
 * in every browser that implements Background Sync, so on the path this worker is woken
 * for, the live value is there. `null` sends no header, and the server's answer decides
 * (`outcomeForFailure`).
 */
const readCookieStoreCsrf = async (): Promise<string | null> => {
  // Typed as always present, actually shipped by Chromium alone.
  const store: CookieStore | undefined = worker.cookieStore
  if (store === undefined) return null
  try {
    return (await store.get(CSRF_COOKIE))?.value ?? null
  } catch {
    return null
  }
}

/**
 * Drains every event this device is holding photos for.
 *
 * Resolves only when nothing is left. Rejecting while entries remain is what makes the
 * browser re-fire the tag later: a sync handler that resolves is a sync the browser
 * considers done, so a worker that swallowed "still offline" would give a guest who
 * closed the tab exactly one attempt and no more.
 */
const drainEverything = async (): Promise<void> => {
  let store: OutboxStore
  try {
    store = await IndexedDbOutbox.open()
  } catch {
    // No database, so nothing to send and nothing to retry. Resolving here is right:
    // rejecting would have the browser retry a tag this phone can never satisfy.
    return
  }

  let held = 0
  try {
    const send = fetchOutboxSender({
      fetch: (...args) => fetch(...args),
      readCsrf: readCookieStoreCsrf,
    })
    for (const slug of await store.slugs()) {
      const report = await drainOutbox({ store, slug, send, now: () => Date.now() })
      held += report.remaining
    }
  } finally {
    store.close()
  }

  if (held > 0) {
    throw new Error(`${held} photo(s) still waiting; ask the browser to try again later`)
  }
}

/** Fills the shell cache. Failure is survivable: the app simply has no offline copy. */
const precache = async (): Promise<void> => {
  const cache = await caches.open(CACHE_NAME)
  // `reload` so a deploy is not precached out of the very HTTP cache it replaces.
  await cache.addAll(__PRECACHE_URLS__.map((url) => new Request(url, { cache: 'reload' })))
}

const sweepOldCaches = async (): Promise<void> => {
  const stale = staleCacheNames(await caches.keys(), CACHE_NAME)
  await Promise.all(stale.map((name) => caches.delete(name)))
}

worker.addEventListener('install', (event) => {
  // Straight to active once the shell is in. Waiting would leave a guest on the previous
  // worker until every tab closed, which at an event means until they go home.
  event.waitUntil(
    // Push-only: there is no shell to keep, and none is fetched.
    pushOnly
      .then((only) =>
        only
          ? undefined
          : // A precache that failed leaves a worker that still drains the outbox, which is
            // the job that must not be lost. Offline loading is the part that degrades.
            precache().catch(() => undefined),
      )
      .then(() => worker.skipWaiting()),
  )
})

worker.addEventListener('activate', (event) => {
  event.waitUntil(sweepOldCaches().then(() => worker.clients.claim()))
})

worker.addEventListener('fetch', (event) => {
  // Returning without `respondWith` is not the same as answering from the network: it
  // hands the request back to the browser untouched, which is what keeps this worker off
  // the critical path of every upload and every SSE frame.
  if (!isShellRequest(event.request, worker.location.origin)) return

  event.respondWith(
    pushOnly.then((only) =>
      only
        ? // Push-only: the network answers, as with no worker.
          fetch(event.request)
        : respondFromShell(event.request, {
            fetch: (...args) => fetch(...args),
            match: async (request) => caches.match(request, { cacheName: CACHE_NAME }),
          }),
    ),
  )
})

worker.addEventListener('sync', (event) => {
  const sync = event as SyncEvent
  if (sync.tag !== OUTBOX_SYNC_TAG) return
  // `waitUntil` keeps the worker alive through the upload and tells the browser to
  // retry the tag if this rejects — which `drainEverything` does on purpose.
  // In push-only mode the queue is off: nothing is drained here, and the page drains what it holds.
  sync.waitUntil(pushOnly.then((only) => (only ? undefined : drainEverything())))
})

worker.addEventListener('message', (event) => {
  const data: unknown = event.data
  if (typeof data !== 'object' || data === null) return
  if (Reflect.get(data, 'type') === PUSH_ONLY_MESSAGE) {
    pushOnly = Promise.resolve(true)
    event.waitUntil(
      writePushOnly(caches, true)
        .then(() => caches.keys())
        .then((names) => Promise.all(ownCacheNames(names).map((name) => caches.delete(name))))
        .then(() => undefined),
    )
    return
  }
  if (Reflect.get(data, 'type') === QUEUE_ON_MESSAGE) {
    // The offline queue is on again: serve as before, with a shell to serve it from.
    pushOnly = Promise.resolve(false)
    event.waitUntil(
      writePushOnly(caches, false)
        .then(() => precache())
        .catch(() => undefined),
    )
    return
  }
  if (Reflect.get(data, 'type') !== KILL_MESSAGE) return
  // The kill switch, from the page. Unregistering from inside the worker is what makes
  // "off" reach a worker that is already installed and misbehaving — and the caches go
  // with it, or the next worker inherits a shell nobody asked for.
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(ownCacheNames(names).map((name) => caches.delete(name))))
      .then(() => worker.registration.unregister())
      .then(() => undefined),
  )
})

/**
 * A reply came in (spec 30, lot 4, Web Push). Every push has to end in a visible notification, so a
 * message that cannot be read still says that something came in. The text is worded here, in the
 * browser's language: the message carries a count and an event's address, nothing a guest wrote.
 */
/** The message of a push, or `null` when it cannot be read as the box writes it. */
const readNotice = (data: PushMessageData | null): ReturnType<typeof parseRsvpNotice> => {
  try {
    return parseRsvpNotice(data?.json())
  } catch {
    return null
  }
}

worker.addEventListener('push', (event) => {
  const notice = readNotice(event.data)
  const words = noticeText(notice?.count ?? null, worker.navigator.language)
  event.waitUntil(
    worker.registration.showNotification(words.title, {
      // A second message for the same event buzzes again instead of silently replacing the first
      // (`renotify` is in the specification and not yet in TypeScript's `NotificationOptions`).
      ...({ renotify: true } as NotificationOptions),
      body: words.body,
      icon: '/icons/icon-192.png',
      tag: notice === null ? 'eventslide-rsvp' : notificationTag(notice.slug),
      data: { path: notice === null ? '/admin' : repliesPath(notice.slug) },
    }),
  )
})

worker.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data: unknown = event.notification.data
  const path = typeof data === 'object' && data !== null ? Reflect.get(data, 'path') : undefined
  if (typeof path !== 'string' || !path.startsWith('/admin')) return
  event.waitUntil(
    worker.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) =>
      openRepliesPage(
        windows.map<OpenWindow>((client) => ({
          url: client.url,
          focus: () => client.focus(),
          navigate: (url) => client.navigate(url),
        })),
        worker.location.origin,
        path,
        (url) => worker.clients.openWindow(url),
      ),
    ),
  )
})
