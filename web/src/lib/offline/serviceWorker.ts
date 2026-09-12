import { deleteOutboxDb } from './indexedDbOutbox'
import { ownCacheNames } from '../pwa/appShell'

/**
 * Registering — and, just as importantly, un-registering — the upload worker.
 *
 * The worker has two jobs: finishing an upload the guest is no longer watching, and
 * answering for the app shell when the network will not. The second is what lets an
 * installed EventSlide open with no connection, and it is also what makes Chromium
 * willing to fire `beforeinstallprompt` at all.
 *
 * Both are narrow, and the shell answer is network-first, so a bug in the worker can
 * delay a photo or serve one stale document to somebody with no network — it cannot put
 * a working deploy behind a cache. This module is the undo button for when it does
 * something worse than that.
 */

/** The Background Sync tag. Shared with `web/sw/serviceWorker.ts` by value, not by
 *  import: the worker is built as its own bundle and shares no module graph. */
export const OUTBOX_SYNC_TAG = 'eventslide-outbox'

/** Asks an already-installed worker to unregister itself and stop. */
export const KILL_MESSAGE = 'eventslide:kill'

/**
 * `ServiceWorkerRegistration.sync` is a living-standard addition TypeScript's DOM
 * library does not declare, so the capability is described here rather than asserted
 * away with a cast. Present on Chromium, absent on WebKit, which is exactly why the
 * foreground drain is the primary path and this is the bonus.
 */
interface SyncCapableRegistration extends ServiceWorkerRegistration {
  readonly sync?: { register(tag: string): Promise<void> }
}

const supported = (): boolean => typeof navigator !== 'undefined' && 'serviceWorker' in navigator

/**
 * Installs the worker, or does nothing at all.
 *
 * Never rejects. A guest whose browser refuses the registration — an insecure origin,
 * a locked-down webview, a quota refusal — must still get the upload screen, and the
 * foreground drain works without a worker.
 */
export const registerUploadWorker = async (url = '/sw.js'): Promise<boolean> => {
  if (!supported()) return false
  try {
    await navigator.serviceWorker.register(url, { scope: '/' })
    return true
  } catch (cause) {
    // Warned rather than swallowed: a registration failing in production is worth
    // seeing in a console someone eventually opens, and `no-console` allows warn.
    console.warn('the upload worker could not be registered', cause)
    return false
  }
}

/**
 * Removes every worker this origin has, and the photos any of them were holding.
 *
 * Both halves matter. Unregistering alone would leave a database no code drains;
 * deleting alone would leave a worker that re-creates it on the next sync.
 */
export const removeUploadWorker = async (): Promise<void> => {
  if (supported()) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      for (const registration of registrations) {
        registration.active?.postMessage({ type: KILL_MESSAGE })
        await registration.unregister()
      }
    } catch (cause) {
      console.warn('the upload worker could not be removed', cause)
    }
  }
  // The page deletes the caches as well as asking the worker to. A worker that was
  // already dead, or one killed before its message handler ran, leaves them behind
  // otherwise — and a stale shell cache with no worker to update it is the one failure
  // a kill switch exists to prevent.
  await dropShellCaches()
  await deleteOutboxDb()
}

/** Deletes every cache this app's worker has ever made, from the page. */
const dropShellCaches = async (): Promise<void> => {
  if (typeof caches === 'undefined') return
  try {
    const names = await caches.keys()
    await Promise.all(ownCacheNames(names).map((name) => caches.delete(name)))
  } catch (cause) {
    console.warn('the cached app shell could not be removed', cause)
  }
}

/**
 * Asks the browser to finish the outbox later, even if this tab is gone.
 *
 * Best-effort by construction: `sync` is absent on WebKit, and a `register` call can be
 * refused outright when the user has denied background activity. Resolves to whether
 * the browser took the job, which the caller uses for nothing but a log — the page
 * drains on `online` regardless, and that is the path every guest gets.
 */
export const requestBackgroundSync = async (): Promise<boolean> => {
  if (!supported()) return false
  try {
    const registration: SyncCapableRegistration = await navigator.serviceWorker.ready
    if (registration.sync === undefined) return false
    await registration.sync.register(OUTBOX_SYNC_TAG)
    return true
  } catch {
    return false
  }
}
