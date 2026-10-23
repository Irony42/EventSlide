import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { LogContext, Logger } from '../../application/ports/logger'
import { errorHandler, requestContext } from './middleware/errorHandler'
import { buildHarness } from './testing/middlewareHarness'
import { buildServerHarness, type ServerHarness } from './testing/serverHarness'

/**
 * Ring 4: a path that is not valid percent-encoding is the client's mistake, a 400.
 *
 * Express decodes a route parameter itself, before any handler runs, and throws a
 * `URIError` stamped `status: 400` when it cannot. That was answered `500 server.unexpected`
 * and logged as "unhandled error" with a stack, which tells a client with a mangled link
 * that the server is broken and files each of them in the error log, where a burst of them
 * reads like an outage. It is a `400 request.invalid`, the same answer a body that is not
 * JSON already gets.
 *
 * It is also a leak, which is the part that matters more. The error's own message is
 * `Failed to decode param '<the raw parameter>'`, and on a gallery, invitation or
 * password-reset path the parameter is the credential: a link copied with its last
 * character cut in half (`/g/<token>%E2%80`) put the whole token into the error log.
 */

/** Distinctive, so finding it anywhere in what was logged is conclusive. */
const TOKEN = 'canary-token-5d1f8a3c9e7b2640'
const BROKEN = '%E0%A4%A'
/** A link's id: public, but not a token, so `loggablePath` leaves it be. */
const LINK_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const SPA_MARKER = '<!-- spa shell for the malformed-path tests -->'

/** A logger that keeps what it was told, and the bindings each child carries. */
class RecordingLogger implements Logger {
  readonly lines: { level: string; message: string; context: LogContext; bindings: LogContext }[] =
    []

  constructor(
    private readonly bindings: LogContext = {},
    lines?: RecordingLogger['lines'],
  ) {
    if (lines !== undefined) this.lines = lines
  }

  private record(level: string, message: string, context: LogContext = {}): void {
    this.lines.push({ level, message, context, bindings: this.bindings })
  }

  debug(message: string, context?: LogContext): void {
    this.record('debug', message, context)
  }

  info(message: string, context?: LogContext): void {
    this.record('info', message, context)
  }

  warn(message: string, context?: LogContext): void {
    this.record('warn', message, context)
  }

  error(message: string, context?: LogContext): void {
    this.record('error', message, context)
  }

  child(bindings: LogContext): Logger {
    return new RecordingLogger({ ...this.bindings, ...bindings }, this.lines)
  }
}

describe('a path that is not valid percent-encoding', () => {
  let clientDir: string

  beforeAll(async () => {
    clientDir = await mkdtemp(join(tmpdir(), 'eventslide-malformed-path-'))
    await writeFile(join(clientDir, 'index.html'), `<!doctype html>${SPA_MARKER}`, 'utf8')
  })

  afterAll(async () => {
    await rm(clientDir, { recursive: true, force: true })
  })

  const serve = (logger: Logger): ServerHarness => buildServerHarness({ clientDir, logger })

  /**
   * Every family of address that carries a parameter or a wildcard, with the token — where
   * there is one — in front of the break: the shape of a link cut in the middle of an escape.
   *
   * The third column says whether the address carries a credential, which is what
   * `loggablePath` redacts: a gallery, invitation or password-reset token. A slug or a link
   * id is not one, and a log line names it as it came.
   */
  const PATHS: readonly (readonly [string, string, boolean])[] = [
    ['an API route parameter', `/api/events/${BROKEN}/wall`, false],
    ['a second API route parameter', `/api/events/mariage/photos/ab${BROKEN}/thumb`, false],
    ['a shared gallery token', `/api/gallery/${TOKEN}${BROKEN}`, true],
    ['a shared gallery token, deeper in the route', `/api/gallery/${TOKEN}${BROKEN}/photos`, true],
    ['a shared gallery media link', `/api/gallery-media/${LINK_ID}${BROKEN}/album.zip`, false],
    ['the gallery page', `/g/${TOKEN}${BROKEN}`, true],
    ['the gallery page, a segment further', `/g/${TOKEN}/${BROKEN}`, true],
    ['the invitation page', `/invite/${TOKEN}${BROKEN}`, true],
    ['the password-reset page', `/password/reset/${TOKEN}${BROKEN}`, true],
    ['the client fallback', `/${BROKEN}`, false],
    ['a client route', `/e/mariage${BROKEN}/display`, false],
  ]

  const CREDENTIAL_PATHS = PATHS.filter(([, , credential]) => credential)

  it.each(PATHS)('is a 400 request.invalid for %s', async (_label, path) => {
    const response = await request(serve(new RecordingLogger()).app).get(path)

    expect(response.status).toBe(400)
    expect(response.headers['content-type']).toMatch(/^application\/json/)
    expect(response.body).toEqual({
      error: { code: 'request.invalid', message: expect.any(String), details: {} },
    })
    // The same envelope as every other refusal, with a request id to ask the log about.
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it.each(PATHS)('never echoes the parameter back for %s', async (_label, path) => {
    const response = await request(serve(new RecordingLogger()).app).get(path)

    // `message` is the one free-text field, and Express's own is `Failed to decode param '…'`.
    expect(JSON.stringify(response.body)).not.toContain(TOKEN)
    expect(JSON.stringify(response.body)).not.toContain('E0')
    expect(JSON.stringify(response.body)).not.toContain('Failed to decode')
  })

  it.each(PATHS)('is not logged as a failure, with no stack, for %s', async (_label, path) => {
    const logger = new RecordingLogger()

    await request(serve(logger).app).get(path)

    // A client's mistake is not a log-level problem: nothing at warn or above, and above
    // all not the "unhandled error" line with its stack that a real bug gets.
    expect(logger.lines.filter((line) => line.level === 'error' || line.level === 'warn')).toEqual(
      [],
    )
    const written = JSON.stringify(logger.lines)
    expect(written).not.toContain('stack')
    expect(written).not.toContain('Failed to decode')
    expect(written).not.toContain('unhandled error')
  })

  it.each(CREDENTIAL_PATHS)('keeps the token out of the log for %s', async (_label, path) => {
    const logger = new RecordingLogger()

    await request(serve(logger).app).get(path)

    expect(logger.lines.length).toBeGreaterThan(0)
    expect(JSON.stringify(logger.lines)).not.toContain(TOKEN)
  })

  it('is logged as the request a client got wrong, and as nothing more', async () => {
    const logger = new RecordingLogger()

    await request(serve(logger).app).get(`/api/events/${BROKEN}/wall`)

    expect(logger.lines.map((line) => [line.level, line.message, line.context])).toEqual([
      ['debug', 'request rejected', { code: 'request.invalid', kind: 'invalid', status: 400 }],
    ])
  })

  it.each([
    ['the gallery page', `/g/${TOKEN}${BROKEN}`, '/g/:token'],
    ['the invitation page', `/invite/${TOKEN}${BROKEN}`, '/invite/:token'],
    ['the password-reset page', `/password/reset/${TOKEN}${BROKEN}`, '/password/reset/:token'],
    [
      'a shared gallery token',
      `/api/gallery/${TOKEN}${BROKEN}/photos`,
      '/api/gallery/:token/photos',
    ],
  ])(
    'logs the path of %s with its token written as :token, broken escape and all',
    async (_label, path, logged) => {
      const logger = new RecordingLogger()

      await request(serve(logger).app).get(path)

      // `loggablePath` redacts by pattern on the raw path, so it does not need the escape
      // to decode: what a log line carries for a mangled link is the same as for a good one.
      expect(logger.lines.length).toBeGreaterThan(0)
      expect(new Set(logger.lines.map((line) => line.bindings['path']))).toEqual(new Set([logged]))
    },
  )

  it.each([
    [
      'a URIError a handler raised itself',
      () => {
        decodeURIComponent('%E0%A4%A')
      },
    ],
    [
      'an error stamped 400 by some other library',
      () => {
        throw Object.assign(new Error('a library chose a status'), { status: 400 })
      },
    ],
  ])('still answers 500, with its stack in the log, for %s', async (_label, fails) => {
    // The mapping is for the router's own decode failure and for nothing wider: it is a
    // `URIError` **and** carries the `status: 400` the router stamps on it. A handler that
    // decodes a header and throws the same class of error is a bug in this codebase, and an
    // error some dependency stamped 400 is not ours to call the client's mistake; both are
    // what the opaque 500 and the stack in the log are for.
    const logger = new RecordingLogger()
    const world = buildHarness({
      routes: (app) => {
        app.use(requestContext(logger))
        app.get('/bug', () => {
          fails()
        })
        app.use(errorHandler())
      },
    })

    const response = await request(world.app).get('/bug')

    expect(response.status).toBe(500)
    expect(response.body.error.code).toBe('server.unexpected')
    expect(logger.lines.map((line) => line.message)).toContain('unhandled error')
  })

  it('leaves a path that decodes alone', async () => {
    // The fix must not turn a legitimate percent-escape into a refusal.
    const response = await request(serve(new RecordingLogger()).app).get(
      '/api/events/ma%20rie/wall',
    )

    expect(response.status).not.toBe(400)
  })
})
