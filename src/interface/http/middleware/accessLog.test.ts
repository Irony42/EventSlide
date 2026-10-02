import fs from 'node:fs'
import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { accessLog, routePatternFor, type AccessLogOptions } from './accessLog'
import { requestContext } from './errorHandler'
import type { Logger } from '../../../application/ports/logger'

/** Nothing: `requestContext` needs a port to hand each request, and this test is not about it. */
const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => noopLogger,
}

/**
 * Captures every complete line pino writes to fd 1 while `emit` runs.
 *
 * pino writes through `sonic-boom`, straight to the file descriptor, below
 * `process.stdout.write` — the same reason `pinoLogger.test.ts` captures here rather
 * than at a higher level.
 */
const linesWhile = async (emit: () => Promise<void>): Promise<string[]> => {
  const written: string[] = []
  const record = (...args: unknown[]): number => {
    const text = Buffer.isBuffer(args[1]) ? args[1].toString('utf8') : String(args[1])
    if (args[0] === 1) written.push(text)
    return Buffer.byteLength(text)
  }
  const asyncWrite = vi.spyOn(fs, 'write').mockImplementation(((...args: unknown[]) => {
    const size = record(...args)
    const callback = args[args.length - 1]
    if (typeof callback === 'function')
      (callback as (e: Error | null, n: number) => void)(null, size)
  }) as unknown as typeof fs.write)
  const syncWrite = vi
    .spyOn(fs, 'writeSync')
    .mockImplementation(((...args: unknown[]) => record(...args)) as unknown as typeof fs.writeSync)
  try {
    await emit()
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    asyncWrite.mockRestore()
    syncWrite.mockRestore()
  }
  return written.join('').split('\n').filter(Boolean)
}

const ENABLED: AccessLogOptions = {
  enabled: true,
  level: 'trace',
  pretty: false,
  service: 'eventslide',
  version: '2.0.0-test',
  instance: 'test-instance',
}

const anApp = (options: AccessLogOptions = ENABLED): express.Express => {
  const app = express()
  app.use(requestContext(noopLogger))
  app.use(accessLog(options))
  app.get('/api/events/:eventSlug/photos', (_req, res) => {
    res.status(200).json({ ok: true })
  })
  app.post('/api/auth/login', express.json(), (_req, res) => {
    res.setHeader('set-cookie', 'es_session=the-fresh-session-id; HttpOnly')
    res.status(200).json({ ok: true })
  })
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'route.notFound' } })
  })
  return app
}

const parsedLines = (lines: string[]): Record<string, unknown>[] =>
  lines.map((line) => JSON.parse(line) as Record<string, unknown>)

describe('accessLog', () => {
  it('logs the route pattern, never the real path', async () => {
    const app = anApp()

    const lines = await linesWhile(async () => {
      await request(app).get('/api/events/our-secret-wedding-2026/photos')
    })

    const [line] = parsedLines(lines)
    expect(line?.['route']).toBe('/api/events/:eventSlug/photos')
    expect(JSON.stringify(line)).not.toContain('our-secret-wedding-2026')
  })

  it('carries the status, the duration and the request id', async () => {
    const app = anApp()

    const lines = await linesWhile(async () => {
      await request(app).get('/api/events/mariage/photos')
    })

    const [line] = parsedLines(lines)
    const res = line?.['res'] as Record<string, unknown> | undefined
    expect(res?.['statusCode']).toBe(200)
    expect(typeof line?.['duration']).toBe('number')
    expect(line?.['requestId']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('carries service, version and instance on every line', async () => {
    const app = anApp()

    const lines = await linesWhile(async () => {
      await request(app).get('/api/events/mariage/photos')
    })

    const [line] = parsedLines(lines)
    expect(line).toMatchObject({
      service: 'eventslide',
      version: '2.0.0-test',
      instance: 'test-instance',
    })
  })

  it('logs an unmatched request without echoing the path it refused', async () => {
    const app = anApp()

    const lines = await linesWhile(async () => {
      await request(app).get('/api/gallery/a-shared-gallery-token-nobody-should-read')
    })

    const [line] = parsedLines(lines)
    expect(line?.['route']).toBe('(unmatched)')
    expect(JSON.stringify(line)).not.toContain('a-shared-gallery-token-nobody-should-read')
  })

  it('never logs a query string', async () => {
    const app = anApp()

    const lines = await linesWhile(async () => {
      await request(app).get('/api/events/mariage/photos?token=canary-in-the-query-9f3e1a')
    })

    expect(JSON.stringify(parsedLines(lines))).not.toContain('canary-in-the-query-9f3e1a')
  })

  it('never logs a request header, such as a cookie or an authorization token', async () => {
    const app = anApp()

    const lines = await linesWhile(async () => {
      await request(app)
        .get('/api/events/mariage/photos')
        .set('Cookie', 'es_session=canary-request-cookie-9f3e1a')
        .set('Authorization', 'Bearer canary-bearer-token-9f3e1a')
    })

    const text = JSON.stringify(parsedLines(lines))
    expect(text).not.toContain('canary-request-cookie-9f3e1a')
    expect(text).not.toContain('canary-bearer-token-9f3e1a')
  })

  it('never logs a response header, such as the Set-Cookie carrying a fresh session id', async () => {
    const app = anApp()

    const lines = await linesWhile(async () => {
      await request(app).post('/api/auth/login').send({})
    })

    expect(JSON.stringify(parsedLines(lines))).not.toContain('the-fresh-session-id')
  })

  it('does nothing at all when disabled: no output, not even a redacted line', async () => {
    const app = anApp({ enabled: false })

    const lines = await linesWhile(async () => {
      await request(app).get('/api/events/mariage/photos')
    })

    expect(lines).toEqual([])
  })
})

describe('routePatternFor', () => {
  const aRequest = (
    overrides: Partial<{ baseUrl: string; route: unknown }>,
  ): Parameters<typeof routePatternFor>[0] =>
    ({ baseUrl: '', route: undefined, ...overrides }) as Parameters<typeof routePatternFor>[0]

  it('joins the mount and the matched path', () => {
    expect(
      routePatternFor(aRequest({ baseUrl: '/api', route: { path: '/events/:eventSlug' } })),
    ).toBe('/api/events/:eventSlug')
  })

  it('reports an array of paths joined, for a route declared with more than one', () => {
    expect(routePatternFor(aRequest({ baseUrl: '', route: { path: ['/g', '/g/*'] } }))).toBe(
      '/g|/g/*',
    )
  })

  it('reports (unmatched) rather than a path, when nothing matched', () => {
    expect(routePatternFor(aRequest({ baseUrl: '/api', route: undefined }))).toBe('(unmatched)')
  })

  it('reports the mount alone for a route matched at its router root', () => {
    expect(routePatternFor(aRequest({ baseUrl: '/api/health', route: { path: '/' } }))).toBe(
      '/api/health',
    )
  })
})
