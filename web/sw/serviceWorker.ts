import { drainOutbox } from '../src/lib/offline/drainOutbox'
import { fetchOutboxSender } from '../src/lib/offline/fetchSender'
import { IndexedDbOutbox } from '../src/lib/offline/indexedDbOutbox'
import type { OutboxStore } from '../src/lib/offline/outbox'

/**
 * The upload worker.
 *
 * It exists for one job: finish sending photos the guest is no longer watching. It
 * caches nothing, intercepts no `fetch`, and claims no navigation — so the worst a bug
 * in here can do is delay a photo. A worker that also served the app shell would put
 * every page load behind this lifecycle, and lifecycle bugs are exactly what makes
 * shipping a service worker frightening.
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

/**
 * The Background Sync tag and the kill message, duplicated by value from
 * `web/src/lib/offline/serviceWorker.ts`.
 *
 * Not imported: that module reaches for `navigator` and belongs to the DOM program. A
 * string literal in two places is the cheaper of the two evils, and both ends are
 * pinned by the end-to-end journey rather than by hope.
 */
const OUTBOX_SYNC_TAG = 'eventslide-outbox'
const KILL_MESSAGE = 'eventslide:kill'

const CSRF_COOKIE = 'es_csrf'

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
 * The live CSRF token.
 *
 * A worker has no `document.cookie`. `cookieStore` is the worker-side reader and exists
 * in every browser that implements Background Sync, so on the path this worker is woken
 * for, the live value is there. `null` falls back to the token captured beside the photo
 * — see `OutboxEntry.csrfToken` for why that is sound for a guest.
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

worker.addEventListener('install', () => {
  // Straight to active. No cached asset's version matters here, so making a guest close
  // every tab before a fixed worker takes over would be ceremony with a cost and no
  // benefit.
  void worker.skipWaiting()
})

worker.addEventListener('activate', (event) => {
  event.waitUntil(worker.clients.claim())
})

worker.addEventListener('sync', (event) => {
  const sync = event as SyncEvent
  if (sync.tag !== OUTBOX_SYNC_TAG) return
  // `waitUntil` keeps the worker alive through the upload and tells the browser to
  // retry the tag if this rejects — which `drainEverything` does on purpose.
  sync.waitUntil(drainEverything())
})

worker.addEventListener('message', (event) => {
  const data: unknown = event.data
  if (typeof data !== 'object' || data === null) return
  if (Reflect.get(data, 'type') !== KILL_MESSAGE) return
  // The kill switch, from the page. Unregistering from inside the worker is what makes
  // "off" reach a worker that is already installed and misbehaving.
  event.waitUntil(worker.registration.unregister().then(() => undefined))
})
