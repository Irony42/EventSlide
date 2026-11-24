/**
 * The names the page, the offline modules and the service worker bundle must agree on.
 *
 * Each of these used to be spelled in `web/sw/serviceWorker.ts` and again in the page's
 * modules, and nothing tied the copies together: a one-sided edit silently disabled
 * Background Sync (the tag the page registers never matched the worker's `sync` listener), the
 * kill switch (the worker ignored the message) or the CSRF echo. They live here once. The worker
 * imports this module as it imports the rest of `web/src/lib`; it touches no `document` or
 * `navigator`, which is what makes that safe.
 *
 * The wire values are pinned by `names.test.ts`: the tag and the message are also held by
 * workers already installed on guests' phones, and the cookie and header are what the server
 * reads (`src/interface/http/middleware/csrf.ts`), so a rename here is a protocol change.
 */

/** The Background Sync tag the page registers and the worker's `sync` listener answers. */
export const OUTBOX_SYNC_TAG = 'eventslide-outbox'

/** What the page posts to an installed worker to make it unregister itself. */
export const KILL_MESSAGE = 'eventslide:kill'

/**
 * What the page posts to a worker that must stay for a push subscription (spec 30, lot 4): drop the
 * shell caches and stop answering fetches and syncs, but keep the registration the subscription lives on.
 */
export const PUSH_ONLY_MESSAGE = 'eventslide:push-only'

/** What the page posts when the offline queue is on again: the worker leaves push-only mode and serves as before. */
export const QUEUE_ON_MESSAGE = 'eventslide:queue-on'

/** The readable cookie holding the double-submit CSRF token. */
export const CSRF_COOKIE = 'es_csrf'

/** The header a state-changing request echoes it in. */
export const CSRF_HEADER = 'x-csrf-token'

/** The IndexedDB database holding queued photos, opened by the page and by the worker. */
export const OUTBOX_DB_NAME = 'eventslide-outbox'

/**
 * The IndexedDB database holding queued voice messages (spec 25), opened by the page and by
 * nothing else.
 *
 * Its own database and not a second store in {@link OUTBOX_DB_NAME}: the photo database is at
 * version 1 on phones that already have it and its upgrade handler leaves as soon as the `entries`
 * store exists, so a store added there would never be created; an installed worker still opens it
 * at version 1; and the kill switch deletes it whole. A recording is the one thing a guest cannot
 * make again, so none of those may reach it. `names.test.ts` pins the value.
 */
export const VOICE_DB_NAME = 'eventslide-voice'
