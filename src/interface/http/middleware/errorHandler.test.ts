import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { asyncHandler } from './asyncHandler'
import { DomainError } from '../../../domain/shared/errors'
import { buildHarness, type Harness } from '../testing/middlewareHarness'

const harness = (isProduction = false): Harness =>
  buildHarness({
    config: { isProduction },
    routes: (app) => {
      app.get('/ok', (req, res) => {
        res.json({ requestId: req.context.requestId })
      })

      app.get('/domain/:kind', (req, _res, next) => {
        const kind = req.params['kind']
        switch (kind) {
          case 'invalid':
            next(DomainError.invalid('photo.captionTooLong', { max: 140 }))
            return
          case 'notFound':
            next(DomainError.notFound('photo.notFound'))
            return
          case 'forbidden':
            next(DomainError.forbidden('auth.forbidden'))
            return
          case 'quota':
            next(DomainError.quotaExceeded('event.quotaExceeded'))
            return
          case 'unexpected':
            next(DomainError.unexpected('server.brokenDependency'))
            return
          default:
            next(DomainError.conflict('photo.illegalTransition'))
        }
      })

      app.get('/zod', (_req, _res, next) => {
        const schema = z.object({ status: z.enum(['a', 'b']), limit: z.number() })
        const parsed = schema.safeParse({ status: 'nope', limit: 'ten' })
        next(parsed.success ? undefined : parsed.error)
      })

      app.get('/boom', (_req, _res) => {
        throw new Error('a secret path /var/data/eventslide.sqlite leaked into the message')
      })

      app.get(
        '/async-boom',
        asyncHandler(async () => {
          await Promise.resolve()
          throw new Error('rejected asynchronously')
        }),
      )

      app.get('/multer', (_req, _res, next) => {
        const error = Object.assign(new Error('File too large'), { code: 'LIMIT_FILE_SIZE' })
        next(error)
      })

      app.get('/multer-count', (_req, _res, next) => {
        const error = Object.assign(new Error('Too many files'), { code: 'LIMIT_FILE_COUNT' })
        next(error)
      })

      app.get('/multer-field-value', (_req, _res, next) => {
        const error = Object.assign(new Error('Field value too long'), {
          code: 'LIMIT_FIELD_VALUE',
        })
        next(error)
      })

      // Not every throw is an `Error`. A rejected promise carrying a plain object, or a
      // library that throws a string, must not make the handler itself throw while
      // building its log line.
      app.get('/non-error', (_req, _res, next) => {
        next({ whatIsThis: 'not an Error' })
      })

      // Headers on the wire, then a failure: the shape of a ZIP export or an SSE frame
      // that dies part-way through.
      app.get(
        '/stream-boom',
        asyncHandler(async (_req, res) => {
          res.status(200).type('application/zip')
          res.write('PK the first bytes of an archive')
          await Promise.resolve()
          throw new Error('the archive failed half-way')
        }),
      )
    },
  })

describe('requestContext', () => {
  it('attaches a request id and echoes it in the response header', async () => {
    const response = await request(harness().app).get('/ok')

    expect(response.status).toBe(200)
    expect(response.get('x-request-id')).toBe(response.body.requestId)
    expect(response.body.requestId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('honours a well-formed client-supplied id, which is useful behind a proxy', async () => {
    const response = await request(harness().app).get('/ok').set('x-request-id', 'trace-abc_123')

    expect(response.body.requestId).toBe('trace-abc_123')
  })

  it.each([
    ['an unbounded value', 'x'.repeat(5000)],
    ['a space', 'a b'],
    ['quotes and a semicolon, which would break a structured log line', 'a";drop b'],
    ['a percent-encoded newline', 'abc%0Adef'],
    ['an empty value', ''],
  ])('ignores a client id containing %s', async (_label, supplied) => {
    const response = await request(harness().app).get('/ok').set('x-request-id', supplied)

    expect(response.body.requestId).not.toBe(supplied)
    expect(response.body.requestId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('cannot be reached with a literal newline through a conforming client', async () => {
    // Node's HTTP client refuses to serialise it, and so does any conforming proxy —
    // which is why the allow-list in the middleware is defence in depth rather than
    // the primary control. Asserted so the reasoning is recorded rather than assumed.
    await expect(request(harness().app).get('/ok').set('x-request-id', 'abc\ndef')).rejects.toThrow(
      /Invalid character in header/,
    )
  })
})

describe('errorHandler', () => {
  it.each([
    ['invalid', 400, 'photo.captionTooLong'],
    ['notFound', 404, 'photo.notFound'],
    ['forbidden', 403, 'auth.forbidden'],
    ['quota', 413, 'event.quotaExceeded'],
    ['conflict', 409, 'photo.illegalTransition'],
    ['unexpected', 500, 'server.brokenDependency'],
  ])('maps a %s domain error to %i', async (kind, status, code) => {
    const response = await request(harness().app).get(`/domain/${kind}`)

    expect(response.status).toBe(status)
    expect(response.body.error.code).toBe(code)
  })

  it('passes structured details through for the client to render', async () => {
    const response = await request(harness().app).get('/domain/invalid')

    expect(response.body.error.details).toEqual({ max: 140 })
  })

  it('turns a zod failure into request.invalid naming the fields, not their values', async () => {
    // Echoing the value would put untrusted input straight back into a response, and
    // for a password field it would put a secret into a log.
    const response = await request(harness().app).get('/zod')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
    expect(response.body.error.details.fields).toContain('status')
    expect(response.body.error.details.fields).toContain('limit')
    expect(JSON.stringify(response.body)).not.toContain('nope')
  })

  it('answers an unexpected throw with an opaque 500 that leaks nothing', async () => {
    const response = await request(harness().app).get('/boom')

    expect(response.status).toBe(500)
    expect(response.body.error.code).toBe('server.unexpected')
    // The message contained a filesystem path. None of it may reach the client.
    expect(JSON.stringify(response.body)).not.toContain('eventslide.sqlite')
    expect(JSON.stringify(response.body)).not.toContain('/var/data')
  })

  it('includes the request id in a 500, so a report can be matched to a log line', async () => {
    const response = await request(harness().app).get('/boom')

    expect(response.body.error.details.requestId).toBe(response.get('x-request-id'))
  })

  it('catches an asynchronously rejected handler instead of crashing the process', async () => {
    // Express 4 does not await a handler, so without asyncHandler this is an
    // unhandledRejection — which would take the wall down mid-event.
    const response = await request(harness().app).get('/async-boom')

    expect(response.status).toBe(500)
    expect(response.body.error.code).toBe('server.unexpected')
  })

  it('translates an oversized upload into a 413 with a code the client can explain', async () => {
    // Multer rejects the request before any of our code runs, so its errors have to be
    // translated here rather than in the upload use case.
    const response = await request(harness().app).get('/multer')

    expect(response.status).toBe(413)
    expect(response.body.error.code).toBe('upload.tooLarge')
  })

  it('translates too many files into a 400', async () => {
    const response = await request(harness().app).get('/multer-count')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('upload.tooManyFiles')
  })

  it('translates a multer limit it has no specific answer for into a plain rejection', async () => {
    // `LIMIT_FIELD_VALUE` and its siblings are still multer refusing the request, so
    // they must not fall through to the opaque 500 that means "this is our bug".
    const response = await request(harness().app).get('/multer-field-value')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('upload.rejected')
  })

  it('answers an opaque 500 when the thrown value is not an Error at all', async () => {
    const response = await request(harness().app).get('/non-error')

    expect(response.status).toBe(500)
    expect(response.body.error.code).toBe('server.unexpected')
  })

  it('destroys the socket when a response has already started', async () => {
    // The status is long gone once headers are on the wire, so a truncated body with a
    // dead socket is the only honest signal that the archive is incomplete. Answering
    // 200 and stopping would hand the client a corrupt ZIP it believes is whole.
    await expect(request(harness().app).get('/stream-boom')).rejects.toThrow(
      /socket hang up|ECONNRESET|aborted/,
    )
  })

  it('leaks no stack trace in production', async () => {
    const response = await request(harness(true).app).get('/boom')

    expect(response.status).toBe(500)
    expect(JSON.stringify(response.body)).not.toContain('at ')
  })
})
