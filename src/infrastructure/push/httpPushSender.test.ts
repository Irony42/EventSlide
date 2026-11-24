import { describe, expect, it } from 'vitest'
import { CapturingLogger } from '../../application/testing/capturingLogger'
import { DEFAULT_PUSH_HOSTS } from '../../domain/push/pushEndpoint'
import { PushSubscription } from '../../domain/push/pushSubscription'
import { asEventId, asUserId } from '../../domain/shared/ids'
import {
  PUSH_MAX_RESPONSE_BYTES,
  PUSH_TIMEOUT_MS,
  PUSH_TTL_SECONDS,
  createHttpPushSender,
  guardedLookup,
  outcomeOfStatus,
  type PushRequest,
  type PushResponse,
} from './httpPushSender'
import { generateVapidKeys } from './webPushCrypto'
import { createECDH } from 'node:crypto'

const vapid = generateVapidKeys()
const browser = createECDH('prime256v1')
browser.generateKeys()
const P256DH = browser.getPublicKey().toString('base64url')
const AUTH = Buffer.alloc(16, 7).toString('base64url')
const NOW = new Date('2026-11-23T10:00:00.000Z')

const subscription = (endpoint: string, keys: { p256dh?: string; auth?: string } = {}) =>
  PushSubscription.create({
    id: 's-1',
    userId: asUserId('u-1'),
    eventId: asEventId('e-1'),
    endpoint,
    p256dh: keys.p256dh ?? P256DH,
    auth: keys.auth ?? AUTH,
    createdAt: NOW,
  })

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123?z=1'

const harness = (
  answer: PushResponse | Error = { status: 201, truncated: false },
  allowedHosts: readonly string[] = DEFAULT_PUSH_HOSTS,
) => {
  const requests: PushRequest[] = []
  const logger = new CapturingLogger()
  const sender = createHttpPushSender({
    keys: { ...vapid, subject: 'mailto:ops@example.org' },
    allowedHosts,
    now: () => NOW,
    logger,
    transport: async (request) => {
      requests.push(request)
      if (answer instanceof Error) throw answer
      return answer
    },
  })
  return { sender, requests, logger }
}

describe('what a push request carries', () => {
  it('goes to the endpoint’s host and path with the VAPID header, the TTL and the content coding', async () => {
    const { sender, requests } = harness()

    const outcome = await sender.send(subscription(ENDPOINT), '{"v":1}')

    expect(outcome).toBe('delivered')
    const [request] = requests
    expect([request?.host, request?.path]).toEqual(['fcm.googleapis.com', '/fcm/send/abc123?z=1'])
    expect(request?.headers['Content-Encoding']).toBe('aes128gcm')
    expect(request?.headers['TTL']).toBe(String(PUSH_TTL_SECONDS))
    expect(request?.headers['Authorization']).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/u)
    expect(request?.timeoutMs).toBe(PUSH_TIMEOUT_MS)
    expect(request?.maxResponseBytes).toBe(PUSH_MAX_RESPONSE_BYTES)
  })

  it('names the push service’s origin as the token’s audience, and never the path', async () => {
    const { sender, requests } = harness()

    await sender.send(subscription(ENDPOINT), '{"v":1}')

    const token = (requests[0]?.headers['Authorization'] ?? '').split(' ')[1]?.slice(2, -1) ?? ''
    const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString())
    expect(claims.aud).toBe('https://fcm.googleapis.com')
    expect(claims.sub).toBe('mailto:ops@example.org')
    expect(claims.exp).toBe(Math.floor(NOW.getTime() / 1000) + 12 * 3600)
  })

  it('sends the payload encrypted, never in the clear', async () => {
    const { sender, requests } = harness()

    await sender.send(subscription(ENDPOINT), '{"v":1,"slug":"fete-de-lea"}')

    const body = requests[0]?.body.toString('latin1') ?? ''
    expect(body).not.toContain('fete-de-lea')
    expect(requests[0]?.body.length).toBeGreaterThan(86)
  })
})

describe('what an answer means', () => {
  it.each([
    [200, 'delivered'],
    [201, 'delivered'],
    [202, 'delivered'],
    [299, 'delivered'],
    [404, 'gone'],
    [410, 'gone'],
    [301, 'failed'],
    [302, 'failed'],
    [307, 'failed'],
    [400, 'failed'],
    [401, 'failed'],
    [403, 'failed'],
    [413, 'failed'],
    [429, 'failed'],
    [500, 'failed'],
    [503, 'failed'],
    [0, 'failed'],
  ])('reads a status %i as %s', (status, outcome) => {
    expect(outcomeOfStatus(status)).toBe(outcome)
  })

  it('removes a subscription on a 404 or a 410, and keeps it on a 403, a redirect and a 5xx', async () => {
    for (const [status, outcome] of [
      [404, 'gone'],
      [410, 'gone'],
      [403, 'failed'],
      [302, 'failed'],
      [500, 'failed'],
    ] as const) {
      const { sender } = harness({ status, truncated: false })
      expect(await sender.send(subscription(ENDPOINT), '{"v":1}')).toBe(outcome)
    }
  })

  it('bounds the exchange: ten seconds, four kilobytes of answer read', () => {
    expect(PUSH_TIMEOUT_MS).toBe(10_000)
    expect(PUSH_MAX_RESPONSE_BYTES).toBe(4096)
  })

  it('logs a refusal by its status only, never the endpoint', async () => {
    const { sender, logger } = harness({ status: 403, truncated: false })

    await sender.send(subscription(ENDPOINT), '{"v":1}')

    expect(JSON.stringify(logger.lines)).toContain('403')
    expect(JSON.stringify(logger.lines)).not.toMatch(/fcm|abc123|https/)
  })

  it('takes an answer longer than the cap as a failure, whatever its status', async () => {
    const { sender } = harness({ status: 201, truncated: true })

    expect(await sender.send(subscription(ENDPOINT), '{"v":1}')).toBe('failed')
  })

  it('takes a network error as a failure that keeps the subscription, and logs its code only', async () => {
    const reset = Object.assign(
      new Error('connect ECONNRESET fcm.googleapis.com/fcm/send/abc123'),
      {
        code: 'ECONNRESET',
      },
    )
    const { sender, logger } = harness(reset)

    expect(await sender.send(subscription(ENDPOINT), '{"v":1}')).toBe('failed')
    expect(JSON.stringify(logger.lines)).toContain('ECONNRESET')
    expect(JSON.stringify(logger.lines)).not.toMatch(/fcm|abc123/)
  })
})

describe('what is refused before any request', () => {
  it.each([
    ['http', 'http://fcm.googleapis.com/x'],
    ['an IP address', 'https://93.184.216.34/x'],
    ['a private address', 'https://10.0.0.8/x'],
    ['localhost', 'https://localhost/x'],
    ['an internal name', 'https://metadata.google.internal/x'],
    ['a host that only ends like an allowed one', 'https://evilfcm.googleapis.com/x'],
    ['a host the narrowed list no longer allows', 'https://web.push.apple.com/x'],
  ])('does not call %s, and calls the subscription gone', async (_name, endpoint) => {
    const { sender, requests } = harness({ status: 201, truncated: false }, ['fcm.googleapis.com'])

    const outcome = await sender.send(subscription(endpoint), '{"v":1}')

    expect(outcome).toBe('gone')
    expect(requests).toHaveLength(0)
  })

  it('calls a subscription whose keys are not a key gone, without a request', async () => {
    const { sender, requests } = harness()
    const offCurve = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url')

    expect(await sender.send(subscription(ENDPOINT, { p256dh: offCurve }), '{"v":1}')).toBe('gone')
    expect(await sender.send(subscription(ENDPOINT, { auth: 'AAAA' }), '{"v":1}')).toBe('gone')
    expect(requests).toHaveLength(0)
  })

  it('does not send a payload longer than one record, and keeps the subscription', async () => {
    const { sender, requests, logger } = harness()

    const outcome = await sender.send(subscription(ENDPOINT), 'x'.repeat(4000))

    expect(outcome).toBe('failed')
    expect(requests).toHaveLength(0)
    expect(logger.lines.some((line) => line.level === 'error')).toBe(true)
  })
})

describe('the connection’s own guard: guardedLookup', () => {
  const resolving =
    (...addresses: { address: string; family: 4 | 6 }[]) =>
    (
      _host: string,
      _options: unknown,
      callback: (
        error: NodeJS.ErrnoException | null,
        found: { address: string; family: number }[],
      ) => void,
    ) =>
      callback(null, addresses)
  const lookup = (resolve: ReturnType<typeof resolving>, options: { all?: boolean } = {}) =>
    new Promise<{ error: NodeJS.ErrnoException | null; found: unknown }>((done) => {
      guardedLookup(resolve as never)('push.example.org', options, (error, found) =>
        done({ error, found }),
      )
    })

  it('hands the connection the public addresses it checked', async () => {
    const resolve = resolving(
      { address: '8.8.8.8', family: 4 },
      { address: '2001:4860:4860::8888', family: 6 },
    )

    const single = await lookup(resolve)
    const all = await lookup(resolve, { all: true })

    expect(single.found).toBe('8.8.8.8')
    expect(all.found).toEqual([
      { address: '8.8.8.8', family: 4 },
      { address: '2001:4860:4860::8888', family: 6 },
    ])
  })

  it('refuses a name that resolves to a private address, even beside a public one', async () => {
    for (const addresses of [
      [{ address: '127.0.0.1', family: 4 as const }],
      [{ address: '169.254.169.254', family: 4 as const }],
      [
        { address: '8.8.8.8', family: 4 as const },
        { address: '10.0.0.5', family: 4 as const },
      ],
      [{ address: '::1', family: 6 as const }],
      [],
    ]) {
      const { error } = await lookup(resolving(...addresses))
      expect(error?.code).toBe('EPUSHADDR')
    }
  })

  it('passes a resolver’s own error on', async () => {
    const failing = (
      _host: string,
      _options: unknown,
      callback: (error: NodeJS.ErrnoException | null, found: never[]) => void,
    ) => callback(Object.assign(new Error('nope'), { code: 'ENOTFOUND' }), [])

    const { error } = await lookup(failing as never)

    expect(error?.code).toBe('ENOTFOUND')
  })
})
