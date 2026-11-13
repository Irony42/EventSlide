import express from 'express'
import { createServer, type Server } from 'node:http'
import { connect, type AddressInfo, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { uploadBodyDeadline } from '../interface/http/middleware/rateLimit'
import {
  applyServerTimeouts,
  configureServer,
  REQUEST_TIMEOUT_MARGIN_MS,
  SERVER_OPTIONS,
  serverTimeouts,
  CONNECTIONS_CHECKING_INTERVAL_MS,
} from './serverTimeouts'

/**
 * Ring 3 in spirit (real sockets, no mocks): the rule is Node's, so only a real
 * `http.Server` and a raw socket can see it (review SEC-02). `index.ts` cannot be
 * imported without listening, which is why the arithmetic lives in `serverTimeouts.ts`.
 * Timeouts are injected small; the production figures are pinned by the arithmetic tests.
 */

const REQUEST_TIMEOUT_MS = 800

const servers: Server[] = []
const sockets: Socket[] = []

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy()
  for (const server of servers.splice(0)) server.close()
})

const listen = async (app: express.Express): Promise<number> => {
  // Node checks timeouts on an interval; shorten it so a test does not wait 30 s.
  const server = createServer({ connectionsCheckingInterval: 50 }, app)
  applyServerTimeouts(server, {
    keepAliveTimeout: 5_000,
    headersTimeout: 500,
    requestTimeout: REQUEST_TIMEOUT_MS,
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as AddressInfo).port
}

const open = async (
  port: number,
): Promise<{ socket: Socket; received: () => string; closed: Promise<void> }> => {
  const socket = connect(port, '127.0.0.1')
  sockets.push(socket)
  let text = ''
  socket.on('data', (chunk) => (text += chunk.toString('latin1')))
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()))
  return { socket, received: () => text, closed }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('serverTimeouts', () => {
  it('ends a JSON request whose body never finishes arriving', async () => {
    const app = express()
    app.use(express.json())
    app.post('/api/join', (_req, res) => res.json({ ok: true }))
    const { socket, received, closed } = await open(await listen(app))

    socket.write(
      'POST /api/join HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 60000\r\n\r\n{',
    )
    const closedInTime = await Promise.race([
      closed.then(() => true),
      sleep(3_000).then(() => false),
    ])

    expect(closedInTime).toBe(true)
    expect(received()).toMatch(/^HTTP\/1\.1 408 /)
  })

  it('leaves an event stream open past the request timeout', async () => {
    const app = express()
    app.get('/stream', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(': open\n\n')
    })
    const { socket, received, closed } = await open(await listen(app))

    socket.write('GET /stream HTTP/1.1\r\nHost: x\r\n\r\n')
    const closedEarly = await Promise.race([
      closed.then(() => true),
      sleep(REQUEST_TIMEOUT_MS * 2.5).then(() => false),
    ])

    expect(closedEarly).toBe(false)
    expect(received()).toMatch(/^HTTP\/1\.1 200 /)
  })

  it('answers a slow upload body with the deadline own 408 before the server timeout speaks', async () => {
    const app = express()
    app.post('/upload', uploadBodyDeadline(250), () => {
      // Never reads the body, never answers: only the deadline can.
    })
    const { socket, received, closed } = await open(await listen(app))

    socket.write(
      'POST /upload HTTP/1.1\r\nHost: x\r\nContent-Type: image/jpeg\r\nContent-Length: 60000\r\n\r\nx',
    )
    await Promise.race([closed, sleep(3_000)])

    expect(received()).toMatch(/^HTTP\/1\.1 408 /)
    expect(received()).toContain('upload.timedOut')
  })

  it('configures a server with the production figures, in milliseconds', () => {
    const server = createServer()

    configureServer(server, 600_000)

    expect(server.requestTimeout).toBe(660_000)
    expect(server.headersTimeout).toBe(70_000)
    expect(server.keepAliveTimeout).toBe(65_000)
    expect(SERVER_OPTIONS.connectionsCheckingInterval).toBe(30_000)
  })

  it('derives the request timeout from the upload deadline plus a margin of two checking intervals', () => {
    const timeouts = serverTimeouts(600_000)

    expect(timeouts.requestTimeout).toBe(600_000 + REQUEST_TIMEOUT_MARGIN_MS)
    expect(REQUEST_TIMEOUT_MARGIN_MS).toBeGreaterThanOrEqual(2 * CONNECTIONS_CHECKING_INTERVAL_MS)
  })

  it('keeps the header and keep-alive timeouts coherent with the request timeout for any upload deadline', () => {
    for (const bodyTimeoutMs of [1_000, 600_000, 86_400_000]) {
      const { keepAliveTimeout, headersTimeout, requestTimeout } = serverTimeouts(bodyTimeoutMs)
      expect(requestTimeout).toBeGreaterThan(bodyTimeoutMs)
      expect(headersTimeout).toBeLessThanOrEqual(requestTimeout)
      expect(headersTimeout).toBeGreaterThan(keepAliveTimeout)
    }
  })
})
