import { outcomeForFailure, outcomeForResults } from './sendOutcome'
import type { OutboxEntry, OutboxSendOutcome, OutboxSender } from './outbox'
import type { RawUploadResult } from './sendOutcome'

/**
 * The service worker's half of the drain, over bare `fetch`.
 *
 * It lives here rather than inside `web/sw/` for one reason: `web/sw/` is built as its
 * own bundle and is covered by no vitest project, so anything that lands there is
 * invisible to the coverage report — not low, *absent*, which is the one way a gap stays
 * hidden (see the note in vitest.config.ts). This module is plain `web/src` code, tested
 * at ring 5 against the same contract as `apiOutboxSender`, and the worker is left as
 * wiring.
 *
 * Nothing here touches `document` or `window`, because the worker's TypeScript program
 * has neither. The CSRF token is therefore read through an injected function: in the
 * worker that is `cookieStore`, which a document does not need and a worker cannot do
 * without.
 */

/** How the caller finds the current CSRF token, if it can. */
export type CsrfReader = () => Promise<string | null>

const CSRF_HEADER = 'x-csrf-token'

/** As loosely as a client should read a response it did not write. */
interface UploadResponseBody {
  readonly results?: readonly RawUploadResult[]
  readonly error?: { readonly code?: string }
}

const parseBody = async (response: Response): Promise<UploadResponseBody> => {
  try {
    return (await response.json()) as UploadResponseBody
  } catch {
    // A proxy error page, or a truncated response. The status is what decides.
    return {}
  }
}

export interface FetchSenderOptions {
  /** Injected so a test can drive it; the worker passes the global. */
  readonly fetch: typeof fetch
  readonly readCsrf: CsrfReader
}

export const fetchOutboxSender = ({ fetch, readCsrf }: FetchSenderOptions): OutboxSender => {
  return async (entry: OutboxEntry): Promise<OutboxSendOutcome> => {
    const form = new FormData()
    form.append('photos', new File([entry.bytes], entry.fileName, { type: entry.fileType }))
    // Omitted rather than sent empty: the server distinguishes "no caption" from an
    // invalid one, exactly as the live upload path does.
    if (entry.caption !== null && entry.caption !== '') form.append('caption', entry.caption)

    const headers: Record<string, string> = { accept: 'application/json' }
    const token = await readCsrf()
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
    if (!response.ok) return outcomeForFailure(response.status, body.error?.code ?? 'unknown')
    return outcomeForResults(body.results)
  }
}
