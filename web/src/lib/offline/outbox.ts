/**
 * The outbox: photos accepted from the guest but not yet accepted by the server.
 *
 * Venue Wi-Fi at a hundred-guest event is not "sometimes slow", it is saturated
 * between 19:00 and 23:00 — exactly the window when photos are taken. Before this
 * existed, a failed upload offered a "Réessayer" button, which only helps a guest who
 * is still looking at their phone. An outbox makes the photo arrive whether or not
 * they are.
 *
 * Everything here is transport-agnostic on purpose. The same entries are drained by
 * two very different runtimes — the page, through `web/src/lib/http.ts`, and the
 * service worker, through bare `fetch` — so the contract between them is a store and
 * a send outcome, never an `ApiError` and never a `Response`.
 */

/** A photo waiting for a usable connection, as it is held on the device. */
export interface OutboxEntry {
  readonly id: string
  /** The event this photo belongs to. A device may hold entries for more than one. */
  readonly slug: string
  /**
   * The bytes, already downscaled.
   *
   * An `ArrayBuffer` rather than the `File` it came from, and that is not a detail.
   * IndexedDB is specified to store a `Blob` by structured clone, but WebKit has a long
   * history of losing or corrupting one — and WebKit on a phone is the browser the
   * largest share of guests actually use, which is exactly the population this feature
   * exists for. A buffer is the boring, portable thing every implementation handles,
   * and the `File` is rebuilt from it and the two fields below at send time.
   */
  readonly bytes: ArrayBuffer
  readonly fileName: string
  readonly fileType: string
  readonly caption: string | null
  /** Epoch milliseconds. Used for expiry, so a stale photo is never sent to a
   *  wedding that ended two days ago. */
  readonly enqueuedAt: number
  /** How many times a drain has tried and been deferred. */
  readonly attempts: number
  /**
   * When the last attempt finished, or `null` before the first.
   *
   * Separate from {@link claimedAt}, and the separation is load-bearing: one field
   * doing both jobs meant that releasing an entry after a failed attempt also looked
   * like a live two-minute lease, so a deferred photo became undrainable for two
   * minutes — long enough that the follow-up drain armed for its two-second backoff
   * found nothing to do and the photo sat there.
   */
  readonly lastAttemptAt: number | null
  /**
   * Epoch milliseconds of the drain that currently holds this entry, or `null` when no
   * drain does.
   *
   * The page and the service worker can both be draining at the same moment — a
   * Background Sync firing while the tab is open is the ordinary case, not a corner
   * one — and without a claim the guest's remaining bandwidth goes on sending the
   * same photo twice. The lease expires (see `outboxPolicy`) so a drain killed
   * mid-flight does not strand the entry for the rest of the evening.
   */
  readonly claimedAt: number | null
  /**
   * The double-submit CSRF token as it stood when the photo was queued.
   *
   * The service worker has no `document.cookie`. It reads the live cookie through
   * `cookieStore` where that exists — which is every browser that implements
   * Background Sync — and falls back to this. Safe to capture here in a way it would
   * not be on the host surface: the token is rotated only by a login or a logout, and
   * a guest does neither. See the note on `upload` in `web/src/lib/http.ts`.
   */
  readonly csrfToken: string | null
}

/** What a caller hands over; the store fills in the rest. */
export interface NewOutboxEntry {
  readonly slug: string
  readonly bytes: ArrayBuffer
  readonly fileName: string
  readonly fileType: string
  readonly caption: string | null
  readonly csrfToken: string | null
}

/**
 * The port. One IndexedDB adapter, one in-memory fake, one shared contract suite —
 * the same arrangement `src/application/ports/` uses on the server side.
 */
export interface OutboxStore {
  /** Appends a photo. Returns the stored entry, id and timestamps included. */
  add(entry: NewOutboxEntry, now: number): Promise<OutboxEntry>
  /** Everything held for one event, oldest first. Never another event's photos. */
  list(slug: string): Promise<readonly OutboxEntry[]>
  /**
   * Every event this device is holding photos for.
   *
   * The page always knows its own slug; the service worker, woken by the browser with
   * no page and no URL, knows nothing at all. This is how a Background Sync finds the
   * work to do.
   */
  slugs(): Promise<readonly string[]>
  /**
   * Takes exclusive ownership of an entry for the length of a lease.
   *
   * Resolves to the claimed entry, or `null` when another drain already holds it. The
   * read and the write are one transaction in the IndexedDB adapter, which is what
   * makes this a claim rather than a suggestion.
   */
  claim(id: string, now: number, leaseMs: number): Promise<OutboxEntry | null>
  /** Gives the entry back after a deferred attempt, counting the attempt. */
  release(id: string, now: number): Promise<void>
  remove(id: string): Promise<void>
  /** Every entry for one event. Used by the kill switch and after a purge. */
  clear(slug: string): Promise<void>
  close(): void
}

/**
 * What became of one attempt to send an entry.
 *
 * Three outcomes, not two, because "the server refused these bytes" and "the server
 * never heard of them" need opposite treatment: the first must drop the entry — the
 * same bytes fail the same way, and keeping them would mean retrying an unsupported
 * format every time the guest walks past an access point — and the second must keep
 * it.
 */
export type OutboxSendOutcome =
  | { readonly kind: 'sent'; readonly photoId: string | null; readonly duplicate: boolean }
  /** The server judged the file or the request itself. Never retried. */
  | { readonly kind: 'rejected'; readonly code: string }
  /** Nothing reached the server, or the server could not answer. Retried later. */
  | { readonly kind: 'deferred' }

/** Sends one entry. Injected, so the page and the service worker share the drain. */
export type OutboxSender = (entry: OutboxEntry) => Promise<OutboxSendOutcome>
