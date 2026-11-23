import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request as httpsRequest } from 'node:https'
import type { LookupFunction } from 'node:net'
import type { Logger } from '../../application/ports/logger'
import type { PushOutcome, PushSender } from '../../application/ports/pushSender'
import { parsePushEndpoint } from '../../domain/push/pushEndpoint'
import { PUSH_PAYLOAD_MAX_BYTES } from '../../domain/push/pushNotice'
import type { PushSubscription } from '../../domain/push/pushSubscription'
import { isPublicAddress } from './publicAddress'
import { encryptAes128gcm, vapidAuthorization } from './webPushCrypto'

/**
 * The adapter that talks to the browsers' push services (spec 30, lot 4). **The first request this
 * box makes to an address a user supplied**, so it is bounded on every side (docs/SECURITY.md,
 * "Web Push"):
 *
 * - the endpoint is judged again against the allowlist (`https`, an allowed host name, never an IP
 *   literal); a subscription that no longer passes is `gone`;
 * - **the connection goes only to a public address**: the name is resolved here and every address it
 *   resolves to must be public, or the connection is refused (a name that points inside the network is
 *   not called) and the address that was checked is the one connected to (no second resolution);
 * - **no redirect is followed** (a `3xx` is a failure), a **10 second** deadline covers the whole
 *   exchange, and **at most 4 KB of the answer is read**;
 * - the endpoint, the keys and the payload are **never logged**: a failure says its outcome and the
 *   HTTP status, and nothing else.
 */

export const PUSH_TIMEOUT_MS = 10_000
export const PUSH_MAX_RESPONSE_BYTES = 4096
/** How long the push service keeps a message for a browser that is off: an hour is plenty for "new replies". */
export const PUSH_TTL_SECONDS = 3600

export interface PushRequest {
  readonly host: string
  readonly path: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: Buffer
  readonly timeoutMs: number
  readonly maxResponseBytes: number
}

export interface PushResponse {
  readonly status: number
  /** The answer was longer than the cap and was cut. */
  readonly truncated: boolean
}

/** What the sender needs from the network: one HTTPS POST. Injected so the rest is tested without one. */
export type PushTransport = (request: PushRequest) => Promise<PushResponse>

type Resolve = (
  host: string,
  options: { all: true; verbatim: true },
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void

/**
 * The `lookup` option of the connection: resolves the name, **refuses it when any address is not
 * public**, and hands the connection the addresses it checked. Exported for its tests.
 */
export const guardedLookup =
  (resolve: Resolve = dnsLookup as Resolve) =>
  (
    host: string,
    options: { all?: boolean; family?: number },
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ): void => {
    resolve(host, { all: true, verbatim: true }, (error, addresses) => {
      if (error !== null) return callback(error, '', 0)
      if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
        const refused: NodeJS.ErrnoException = new Error('push address refused')
        refused.code = 'EPUSHADDR'
        return callback(refused, '', 0)
      }
      if (options.all === true) return callback(null, addresses)
      const first = addresses[0] as LookupAddress
      return callback(null, first.address, first.family)
    })
  }

/** The network, for real: an HTTPS POST that goes only to public addresses and follows nothing. */
export const httpsPushTransport: PushTransport = (request) =>
  new Promise((resolve, reject) => {
    const clientRequest = httpsRequest(
      {
        host: request.host,
        port: 443,
        path: request.path,
        method: 'POST',
        headers: { ...request.headers, 'Content-Length': String(request.body.length) },
        lookup: guardedLookup() as unknown as LookupFunction,
        // A certificate that does not verify is never accepted: the default, said out loud.
        rejectUnauthorized: true,
      },
      (response) => {
        let read = 0
        let truncated = false
        response.on('data', (chunk: Buffer) => {
          read += chunk.length
          if (read > request.maxResponseBytes && !truncated) {
            truncated = true
            response.destroy()
          }
        })
        const done = (): void => resolve({ status: response.statusCode ?? 0, truncated })
        response.on('end', done)
        response.on('close', done)
        response.on('error', done)
      },
    )
    // One deadline for the whole exchange, so a service that drips bytes cannot hold the box.
    const deadline = setTimeout(() => {
      clientRequest.destroy(new Error('push deadline'))
    }, request.timeoutMs)
    clientRequest.on('error', (error) => {
      clearTimeout(deadline)
      reject(error)
    })
    clientRequest.on('close', () => clearTimeout(deadline))
    clientRequest.end(request.body)
  })

/** What a status says: 2xx delivered, 404 and 410 gone for good, the rest (3xx included) a failure. */
export const outcomeOfStatus = (status: number): PushOutcome =>
  status >= 200 && status < 300 ? 'delivered' : status === 404 || status === 410 ? 'gone' : 'failed'

export interface HttpPushSenderDeps {
  readonly keys: {
    readonly publicKey: string
    readonly privateKey: string
    readonly subject: string
  }
  readonly allowedHosts: readonly string[]
  readonly now: () => Date
  readonly logger: Logger
  readonly transport?: PushTransport
}

export const createHttpPushSender = ({
  keys,
  allowedHosts,
  now,
  logger,
  transport = httpsPushTransport,
}: HttpPushSenderDeps): PushSender => ({
  send: async (subscription: PushSubscription, payload: string): Promise<PushOutcome> => {
    const body = Buffer.from(payload, 'utf8')
    // A payload this box wrote too long is a bug here, not a reason to forget the browser.
    if (body.length > PUSH_PAYLOAD_MAX_BYTES) {
      logger.error('push payload too long', { bytes: body.length })
      return 'failed'
    }
    // Judged again, with today's list: the operator may have narrowed it since the host subscribed.
    const endpoint = parsePushEndpoint(subscription.endpoint, allowedHosts)
    if (!endpoint.ok) return 'gone'
    const url = new URL(endpoint.value)

    let encrypted: Buffer
    try {
      encrypted = encryptAes128gcm({
        plaintext: body,
        uaPublic: Buffer.from(subscription.p256dh, 'base64url'),
        authSecret: Buffer.from(subscription.auth, 'base64url'),
      })
    } catch {
      // Keys that are not a key (not on the curve): this subscription can never work.
      return 'gone'
    }

    try {
      const authorization = vapidAuthorization({
        audience: url.origin,
        subject: keys.subject,
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
        nowSeconds: Math.floor(now().getTime() / 1000),
      })
      const response = await transport({
        host: url.hostname,
        path: `${url.pathname}${url.search}`,
        headers: {
          Authorization: authorization,
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: String(PUSH_TTL_SECONDS),
        },
        body: encrypted,
        timeoutMs: PUSH_TIMEOUT_MS,
        maxResponseBytes: PUSH_MAX_RESPONSE_BYTES,
      })
      const outcome = response.truncated ? 'failed' : outcomeOfStatus(response.status)
      if (outcome === 'failed') {
        // The status only: neither the endpoint nor a word of the answer.
        logger.warn('a push message was not delivered', { status: response.status })
      }
      return outcome
    } catch (error) {
      // The error's code only (a refused address, a timeout, a reset): its message names the host.
      const code = (error as NodeJS.ErrnoException).code
      logger.warn('a push message could not be sent', {
        code: typeof code === 'string' ? code : 'error',
      })
      return 'failed'
    }
  },
})
