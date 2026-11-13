import type { Server } from 'node:http'

/**
 * The socket-level timeouts of the HTTP server, derived in one place so they can be
 * tested (`index.ts` cannot be imported without listening).
 *
 * What Node's `requestTimeout` is: how long the server waits to **receive** a request,
 * headers and body. It never ends a response. A GET that answers for hours (the SSE
 * stream) or for minutes (the ZIP export) has no body and is not concerned, so the old
 * `requestTimeout = 0` bought nothing for them and left every JSON route open to a
 * body sent a byte a minute, before any rate limiter (review SEC-02).
 *
 * The only request that legitimately takes long to *receive* is an upload, bounded by
 * `uploadBodyDeadline` (`UPLOAD_BODY_TIMEOUT_SECONDS`). So the server timeout is that
 * plus a margin: on the upload routes the deadline's own `408 upload.timedOut` JSON
 * answer speaks first, and Node's bare 408 is only the backstop.
 */

/**
 * Node looks at open connections every `connectionsCheckingInterval` (30 s by default),
 * so a timeout fires up to that much late, never early. The margin must cover one such
 * interval plus the time between the request starting and the deadline's clock starting
 * (the body parsers and `requireGuest` run first); twice the interval is generous.
 */
export const CONNECTIONS_CHECKING_INTERVAL_MS = 30_000
export const REQUEST_TIMEOUT_MARGIN_MS = 60_000

export interface ServerTimeouts {
  readonly keepAliveTimeout: number
  readonly headersTimeout: number
  readonly requestTimeout: number
}

const HEADERS_TIMEOUT_MS = 70_000

export const serverTimeouts = (uploadBodyTimeoutMs: number): ServerTimeouts => ({
  // Node's default is 5 s, shorter than a guest uploading four photos over congested
  // venue Wi-Fi: too low and the connection is closed between two requests.
  keepAliveTimeout: 65_000,
  // Headers only; must stay below `requestTimeout` (Node rejects the reverse) and above
  // `keepAliveTimeout` (a reverse proxy reusing an idle connection must not race it).
  headersTimeout: HEADERS_TIMEOUT_MS,
  // Never below `headersTimeout`: a one-second upload deadline (the schema allows it)
  // would otherwise ask for a request timeout shorter than the header timeout.
  requestTimeout: Math.max(uploadBodyTimeoutMs + REQUEST_TIMEOUT_MARGIN_MS, HEADERS_TIMEOUT_MS),
})

export const applyServerTimeouts = (server: Server, timeouts: ServerTimeouts): void => {
  server.keepAliveTimeout = timeouts.keepAliveTimeout
  server.headersTimeout = timeouts.headersTimeout
  server.requestTimeout = timeouts.requestTimeout
}
