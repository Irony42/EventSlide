import { drainOutbox } from '../src/lib/offline/drainOutbox'
import { IndexedDbOutbox } from '../src/lib/offline/indexedDbOutbox'
import { shouldQueue } from '../src/lib/offline/outboxPolicy'
import type { OutboxEntry, OutboxSendOutcome, OutboxStore } from '../src/lib/offline/outbox'

/**
 * The upload worker.
 *
 * It exists for one job: finish sending photos the guest is no longer watching. It
 * caches nothing, intercepts no `fetch`, and claims no navigation — so the worst a bug
 * in here can do is delay a photo. A worker that also served the app shell would put
 * every page load behind this lifecycle, and lifecycle bugs are exactly what makes
 * shipping a service worker frightening.
 *
 * It is built as its own bundle (`web/vite.sw.config.ts` to `dist/client/sw.js`) and
 * type-checked as its own program (`tsconfig.sw.json`), because a worker global scope
 * and a DOM global scope cannot coexist in one TypeScript program. It shares the outbox
 * modules with the page by import, which is what keeps the two drains honest: one store
 * schema, one claim, one set of rules.
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
const CSRF_HEADER = 'x-csrf-token'

/** `sync` is a Background Sync addition TypeScript's worker library does not declare. */
interface SyncEvent extends ExtendableEvent {
  readonly tag: string
}

/**
 * `self` inside a service worker really is a `ServiceWorkerGlobalScope`, but the
 * worker library types it as the base `WorkerGlobalScope` — the same declaration
 * serves dedicated and shared workers — so this narrowing is unavoidable. It is the one
 * cast in the file, it is to a real interface rather than to `any`, and it is wrong
 * only if this bundle is loaded as something other than a service worker.
 */
const worker = self as unknown as ServiceWorkerGlobalScope

/**
 * The live CSRF token, or the one captured when the photo was queued.
 *
 * A worker has no `document.cookie`. `cookieStore` is the worker-side reader and exists
 * in every browser that implements Background Sync, so on the path this worker is woken
 * for, the live value is there. The stored token is the fallback, and it is sound for
 * the reason spelled out on `OutboxEntry.csrfToken`: the token rotates on a login and a
 * logout, and a guest does neither.
 */
const csrfToken = async (entry: OutboxEntry): Promise<string | null> => {
  // Typed as always present, actually shipped by Chromium alone. WebKit reaches this
  // line only if it ever gains Background Sync without gaining `cookieStore`.
  const store: CookieStore | undefined = worker.cookieStore
  if (store !== undefined) {
    try {
      const value = (await store.get(CSRF_COOKIE))?.value
      if (value !== undefined) return value
    } catch {
      // Fall through to the captured token.
    }
  }
  return entry.csrfToken
}

/** What the upload endpoint answers, as much of it as the worker reads. */
interface UploadResultBody {
  readonly results?: readonly {
    readonly status?: string
    readonly photoId?: string
    readonly code?: string
  }[]
  readonly error?: { readonly code?: string }
}

const parseBody = async (response: Response): Promise<UploadResultBody> => {
  try {
    return (await response.json()) as UploadResultBody
  } catch {
    // A proxy error page, or a truncated response. The status is what decides.
    return {}
  }
}

/**
 * The worker's half of the drain, over bare `fetch`.
 *
 * The page's half (`web/src/lib/offline/apiSender.ts`) goes through the ordinary
 * transport; this one cannot, because that module is built for a document. Both produce
 * the same three outcomes, which is the contract `drainOutbox` is written against.
 */
const send = async (entry: OutboxEntry): Promise<OutboxSendOutcome> => {
  const form = new FormData()
  form.append('photos', new File([entry.bytes], entry.fileName, { type: entry.fileType }))
  if (entry.caption !== null && entry.caption !== '') form.append('caption', entry.caption)

  const token = await csrfToken(entry)
  const headers: Record<string, string> = { accept: 'application/json' }
  if (token !== null) headers[CSRF_HEADER] = token

  let response: Response
  try {
    response = await fetch(`/api/events/${encodeURIComponent(entry.slug)}/photos`, {
      method: 'POST',
      body: form,
      headers,
      // The guest's device token lives in an HttpOnly cookie, and the request is worth
      // nothing without it.
      credentials: 'same-origin',
    })
  } catch {
    // Still no network. The ordinary case for a worker woken optimistically.
    return { kind: 'deferred' }
  }

  const body = await parseBody(response)

  if (!response.ok) {
    return shouldQueue(response.status)
      ? { kind: 'deferred' }
      : { kind: 'rejected', code: body.error?.code ?? 'unknown' }
  }

  const outcome = body.results?.[0]
  if (outcome === undefined) return { kind: 'deferred' }
  if (outcome.status === 'rejected') return { kind: 'rejected', code: outcome.code ?? 'unknown' }
  return {
    kind: 'sent',
    photoId: outcome.photoId ?? null,
    duplicate: outcome.status === 'duplicate',
  }
}

/** Drains every event this device is holding photos for. */
const drainEverything = async (): Promise<void> => {
  let store: OutboxStore
  try {
    store = await IndexedDbOutbox.open()
  } catch {
    // No database, nothing to send. Throwing here would have the browser retry the tag
    // forever on a phone that can never satisfy it.
    return
  }

  try {
    for (const slug of await store.slugs()) {
      await drainOutbox({ store, slug, send, now: () => Date.now() })
    }
  } finally {
    store.close()
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
  // retry the tag if this rejects.
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
