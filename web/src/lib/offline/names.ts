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

/** The readable cookie holding the double-submit CSRF token. */
export const CSRF_COOKIE = 'es_csrf'

/** The header a state-changing request echoes it in. */
export const CSRF_HEADER = 'x-csrf-token'

/** The IndexedDB database holding queued photos, opened by the page and by the worker. */
export const OUTBOX_DB_NAME = 'eventslide-outbox'
