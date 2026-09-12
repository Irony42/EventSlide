import { isTerminal } from './outboxPolicy'
import type { OutboxSendOutcome } from './outbox'

/**
 * What the upload endpoint said, reduced to the three answers the drain acts on.
 *
 * Shared by both senders on purpose. The page goes through the ordinary transport and
 * the service worker goes through bare `fetch`, and before this existed each mapped the
 * response for itself — two implementations of one wire contract, which is exactly what
 * `outboxStoreContract` exists to prevent on the store side. A divergence here does not
 * show up as a type error or a failing build: it shows up as a photo the worker throws
 * away and the page would have kept.
 */

/** One per-file result, as loosely as a client should read a response it did not write. */
export interface RawUploadResult {
  readonly status?: string
  readonly photoId?: string | null
  readonly code?: string
}

/**
 * The outcome for a 2xx.
 *
 * A missing or unreadable result defers rather than discards. A newer server is allowed
 * to grow its response, and deleting a guest's photo over a field name would be the
 * worst possible reading of "I did not understand that".
 */
export const outcomeForResults = (
  results: readonly RawUploadResult[] | undefined,
): OutboxSendOutcome => {
  const outcome = results?.[0]
  if (outcome === undefined) return { kind: 'deferred' }
  if (outcome.status === 'rejected') {
    // The server looked at these bytes and refused them by name. This is the one
    // answer that is genuinely about the photo rather than about the moment.
    return { kind: 'rejected', code: outcome.code ?? 'unknown' }
  }
  return {
    kind: 'sent',
    photoId: outcome.photoId ?? null,
    duplicate: outcome.status === 'duplicate',
  }
}

/**
 * The outcome for a request that failed.
 *
 * `status` is `0` for "nothing reached the server". `code` is the server's machine
 * string, or `'unknown'` when there was none to read.
 *
 * Everything defers unless {@link isTerminal} names the code. That default is the
 * safeguard: a status this build has never seen, a proxy error page, a 429 from a venue
 * behind one NAT — none of those are a reason to delete a photo off somebody's phone.
 */
export const outcomeForFailure = (status: number, code: string): OutboxSendOutcome => {
  if (status === 0) return { kind: 'deferred' }
  return isTerminal(code) ? { kind: 'rejected', code } : { kind: 'deferred' }
}
