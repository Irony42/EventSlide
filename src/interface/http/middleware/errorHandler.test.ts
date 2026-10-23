import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { LogContext, Logger } from '../../../application/ports/logger'
import { asyncHandler } from './asyncHandler'
import { errorHandler, loggablePath, requestContext } from './errorHandler'
import express from 'express'
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

      // A string field given an array: zod 4 reports the wrong type and then still runs the
      // length rules on it, so one path arrives as two issues. The nested key is the second case.
      app.get('/zod-repeat', (_req, _res, next) => {
        const schema = z.strictObject({
          name: z.string().min(1).max(200),
          theme: z.strictObject({ accentHue: z.number().int().min(0).max(359) }),
        })
        const parsed = schema.safeParse({ name: [], theme: { accentHue: 'x' } })
        next(parsed.success ? undefined : parsed.error)
      })

      // zod 4 types an issue's path as `PropertyKey[]`. No JSON body can put a symbol there, but a
      // path that holds one must still be a 400 and not a TypeError out of the error handler.
      app.get('/zod-symbol', (_req, _res, next) => {
        next(
          new z.ZodError([
            { code: 'custom', path: ['name', Symbol('hidden')], message: 'no', input: null },
          ]),
        )
      })

      // Twelve fields wrong at once, and an unknown key beside a wrong one.
      app.get('/zod-many', (_req, _res, next) => {
        const names = Array.from({ length: 12 }, (_unused, at) => `field${at}`)
        const schema = z.strictObject(Object.fromEntries(names.map((name) => [name, z.string()])))
        const parsed = schema.safeParse(Object.fromEntries(names.map((name) => [name, 1])))
        next(parsed.success ? undefined : parsed.error)
      })
      app.get('/zod-unknown-and-wrong', (_req, _res, next) => {
        const parsed = z.strictObject({ name: z.string() }).safeParse({ name: 1, colour: 'red' })
        next(parsed.success ? undefined : parsed.error)
      })

      // An object that refuses unknown keys reports the unknown one on the object itself, which
      // has no path of its own: the request is refused and no field is named.
      app.get('/zod-unknown-key', (_req, _res, next) => {
        const schema = z.strictObject({ name: z.string() })
        const parsed = schema.safeParse({ name: 'x', colour: 'red' })
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

      // No wrapper: Express 5 forwards a handler's rejected promise to the error handler
      // itself, which is what makes `asyncHandler` belt and braces instead of the only thing
      // between a failed database read and a process-level `unhandledRejection`.
      app.get('/bare-async-boom', async () => {
        await Promise.resolve()
        throw new Error('rejected asynchronously, with nothing wrapped around it')
      })

      app.get('/bare-async-domain', async () => {
        await Promise.resolve()
        throw DomainError.notFound('photo.notFound')
      })

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

describe('the path a request is logged under', () => {
  const TOKEN = 'Zq3_x-Lk9'.repeat(4) + 'abcdefg'

  /** Records the bindings every request's logger is made with. */
  const bindingsOf = async (path: string): Promise<LogContext[]> => {
    const recorded: LogContext[] = []
    const recording: Logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      child: (bindings) => {
        recorded.push(bindings)
        return recording
      },
    }
    const app = express()
    app.use(requestContext(recording))
    app.use((_req, res) => {
      res.status(204).end()
    })
    await request(app).get(path)
    return recorded
  }

  it.each([
    ['the gallery page', `/g/${TOKEN}`, '/g/:token'],
    ['the page a password-reset link opens', `/password/reset/${TOKEN}`, '/password/reset/:token'],
    [
      'that page in another case, which Express routes the same',
      `/Password/Reset/${TOKEN}`,
      '/Password/Reset/:token',
    ],
    ['the page an invitation link opens', `/invite/${TOKEN}`, '/invite/:token'],
    ['that page in another case', `/Invite/${TOKEN}`, '/Invite/:token'],
    ['the preview of an invitation', `/api/invitations/${TOKEN}`, '/api/invitations/:token'],
    [
      'the acceptance of an invitation',
      `/api/invitations/${TOKEN}/accept`,
      '/api/invitations/:token/accept',
    ],
    [
      'the preview of an invitation with a doubled slash',
      `/api//invitations/${TOKEN}`,
      '/api/invitations/:token',
    ],
    [
      'the acceptance of an invitation with several doubled slashes',
      `//api///invitations//${TOKEN}/accept`,
      '/api/invitations/:token/accept',
    ],
    ['a gallery with a doubled slash', `/api//gallery/${TOKEN}`, '/api/gallery/:token'],
    ['a reset page with a doubled slash', `//password//reset/${TOKEN}`, '/password/reset/:token'],
    ['the album', `/api/gallery/${TOKEN}`, '/api/gallery/:token'],
    ['a page of it', `/api/gallery/${TOKEN}/photos`, '/api/gallery/:token/photos'],
    ['the unlock', `/api/gallery/${TOKEN}/unlock`, '/api/gallery/:token/unlock'],
    [
      'a path in another case, which Express routes the same',
      `/API/Gallery/${TOKEN}`,
      '/API/Gallery/:token',
    ],
    // The same addresses spelled with a percent-escape of a letter, which is the same
    // address to a decoder (RFC 3986 section 2.3: an escaped unreserved character is
    // equivalent to the character).
    ['the gallery page, its first letter escaped', `/%67/${TOKEN}`, '/g/:token'],
    ['that page with an escaped capital', `/%47/${TOKEN}`, '/G/:token'],
    [
      'the gallery API with escapes in both segments',
      `/%61p%69/gal%6Cery/${TOKEN}`,
      '/api/gallery/:token',
    ],
    [
      'a page of the gallery with an escape after the token too',
      `/api/gallery/${TOKEN}/ph%6Ftos`,
      '/api/gallery/:token/photos',
    ],
    [
      'a reset page with the escape in lower case',
      `/password/%72eset/${TOKEN}`,
      '/password/reset/:token',
    ],
    [
      'a reset page with the escape in upper case',
      `/%50assword/Reset/${TOKEN}`,
      '/Password/Reset/:token',
    ],
    [
      'the invitation page, its whole name escaped',
      `/%69%6e%76%69%74%65/${TOKEN}`,
      '/invite/:token',
    ],
    [
      'the acceptance of an invitation, escaped and doubled together',
      `//api//%69nvitations///${TOKEN}/accept`,
      '/api/invitations/:token/accept',
    ],
    ['a token that is itself escaped', `/g/%74oken-%41%42`, '/g/:token'],
    [
      'every other unreserved escape, after the token',
      `/%67/${TOKEN}/a%2Db%2dc%2Ed%5Fe%7Ef%31`,
      '/g/:token/a-b-c.d_e~f1',
    ],
    [
      'an address spelled with an escape and cut in the middle of another one',
      `/%67/${TOKEN}%E0%A4%A`,
      '/g/:token',
    ],
    [
      'an address spelled with an escape, then a bare percent sign after the token',
      `/%67/${TOKEN}%`,
      '/g/:token',
    ],
  ])('never carries a gallery token: %s', async (_label, path, logged) => {
    // The token is the credential: whoever reads a log line holding it reads the album.
    const [bindings] = await bindingsOf(path)

    expect(bindings?.['path']).toBe(logged)
    expect(JSON.stringify(bindings)).not.toContain(TOKEN)
  })

  // These are called directly, not sent: an HTTP client resolves dot segments before it sends
  // the request (the WHATWG URL parser does), so a test through supertest would never carry one.
  // `loggablePathLogCanary.test.ts` sends them raw, through a real socket.
  it.each([
    ['the gallery page with a dot segment before the token', `/g/./${TOKEN}`, '/g/:token'],
    ['that dot segment escaped', `/g/%2e/${TOKEN}`, '/g/:token'],
    ['several dot segments on the invitation page', `/invite/././${TOKEN}`, '/invite/:token'],
    [
      'a parent segment in front of the address',
      `/x/../password/reset/${TOKEN}`,
      '/password/reset/:token',
    ],
    ['a parent segment at the root', `/../g/${TOKEN}`, '/g/:token'],
    // Resolved, `/g/<t>/..` is `/g` and the token is gone: the path is read unresolved as well.
    ['a parent segment after the token, which would remove it', `/g/${TOKEN}/..`, '/g/:token/..'],
    ['two of them', `/invite/${TOKEN}/../..`, '/invite/:token/../..'],
    [
      'the gallery API with a dot segment, and a page after the token',
      `/api/gallery/./${TOKEN}/photos`,
      '/api/gallery/:token/photos',
    ],
  ])('never carries a gallery token: %s', (_label, path, logged) => {
    expect(loggablePath(path)).toBe(logged)
    expect(loggablePath(path)).not.toContain(TOKEN)
  })

  it.each([
    ['a signed media URL, which carries no token', '/api/gallery-media/aaaa/bbbb/thumb'],
    ['a guest route', '/api/events/camille-et-sacha/photos'],
    ['a client route that only starts like the gallery', '/gala/2026'],
    ['the page that asks for a reset, which carries no token', '/password/forgot'],
    ['a route that only starts like the reset page', '/password/reset-help'],
    ['a path that only starts like the invitation page', '/invited/2026'],
    ['a path with a doubled slash and no token in it, as it came', '/api//events/camille/photos'],
    ['the invitation routes with no token in them', '/api/invitations'],
    // Only the match is made on the normalised path: a path that carries no token is
    // logged as it came, escapes and all, so a host reading a log sees what the client sent.
    ['an escaped unreserved character in a path with no token', '/api/events/%6Dariage/photos'],
    ['an escaped space, which is not unreserved', '/api/events/ma%20rie/wall'],
    ['an escaped slash in front of a name that is a family', `/%2Fg/${TOKEN}`],
    ['an escaped slash inside the name of a family', `/g%2F${TOKEN}`],
    ['a double-escaped letter, which is not that letter', `/%2567/${TOKEN}`],
    ['an escape that is cut', '/api/events/%E0%A4%A/wall'],
    ['a bare percent sign', '/100%'],
    ['an escape of a letter that is not the name of a family', '/%67ala/2026'],
    ['dot segments in a path with no token', '/a/./b/../c'],
  ])('logs %s as it is', (_label, path) => {
    expect(loggablePath(path)).toBe(path)
  })

  it.each([
    ['a lone percent sign', '%'],
    ['a percent sign and one digit', '/g/%4'],
    ['an escape that is not hexadecimal', '/%ZZ/g/%GG'],
    ['a cut multi-byte sequence', `/%E0%A4%A/g/${TOKEN}`],
    ['a name cut by a lone percent sign', `/g%/${TOKEN}`],
    ['an empty path', ''],
    ['only dot segments', '/./../..'],
    ['a parent segment and nothing else', '/..'],
  ])('does not throw on a path it cannot decode: %s', (_label, path) => {
    // The decoding it does is of one escape at a time and only of a letter, a digit or one
    // of `-._~`, so there is no sequence that fails: a `%` that is not an escape is left as
    // it was, and it cannot spell the name of a family. Held here so a later switch to
    // `decodeURIComponent` on the whole path, which throws on these, is a red test and not a
    // 500 from the logger of every request.
    expect(() => loggablePath(path)).not.toThrow()
  })

  it('still reads the address in front of an escape it cannot decode, and redacts its token', () => {
    expect(loggablePath(`/%67/${TOKEN}%E0%A4%A/%`)).toBe('/g/:token/%')
    expect(loggablePath(`/%67/${TOKEN}/%ZZ/%4`)).toBe('/g/:token/%ZZ/%4')
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

  it('names at most ten fields, which docs/API.md §1 promises and a response size depends on', async () => {
    const response = await request(harness().app).get('/zod-many')

    expect(response.status).toBe(400)
    expect(response.body.error.details.fields.split(', ')).toHaveLength(10)
  })

  it('leaves out the empty path of an unknown key when a field is wrong beside it', async () => {
    // The key sits on the object, which has no path of its own. Counting it would print
    // `name, ` and spend a slot of the ten on nothing.
    const response = await request(harness().app).get('/zod-unknown-and-wrong')

    expect(response.body.error.details).toEqual({ fields: 'name' })
    expect(JSON.stringify(response.body)).not.toContain('colour')
  })

  it('names a field once however many rules it broke, and a nested one by its dotted path', async () => {
    // docs/API.md §1: "names up to ten offending paths". Counting a path twice spends a slot
    // of the ten on the repeat and tells the caller nothing new.
    const response = await request(harness().app).get('/zod-repeat')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
    expect(response.body.error.details).toEqual({ fields: 'name, theme.accentHue' })
  })

  it('names a path that holds a symbol as text instead of failing while it describes the failure', async () => {
    const response = await request(harness().app).get('/zod-symbol')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
    expect(response.body.error.details).toEqual({ fields: 'name.Symbol(hidden)' })
  })

  it('refuses an unknown key as request.invalid with no field named, since the key sits on the object', async () => {
    const response = await request(harness().app).get('/zod-unknown-key')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
    expect(response.body.error.details).toEqual({ fields: '' })
    expect(JSON.stringify(response.body)).not.toContain('colour')
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

  it('catches a bare async handler too, because Express 5 forwards its rejection itself', async () => {
    // The guard on what `asyncHandler` stopped being the only defence for. Express 4 left
    // this request hanging and the rejection unhandled; Express 5 hands it to `next(err)`,
    // so the opaque 500 is the framework's doing and `errorHandler` is where it lands. The
    // rule that every route is wrapped stands — the wrapper is what a review checks for —
    // but a handler somebody forgets to wrap is no longer an outage.
    const response = await request(harness().app).get('/bare-async-boom')

    expect(response.status).toBe(500)
    expect(response.body.error.code).toBe('server.unexpected')
  })

  it('maps a DomainError rejected from a bare async handler as it maps one thrown inside a wrapped one', async () => {
    // The same table, whichever way the rejection arrives: a `notFound` is a 404 with its
    // own code, never the opaque 500 an unrecognised failure gets.
    const response = await request(harness().app).get('/bare-async-domain')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('photo.notFound')
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

describe('the stack trace of an unhandled error, as logged', () => {
  /** Every call `errorHandler` made on the logger it was handed. */
  const errorCallsFrom = async (): Promise<LogContext[]> => {
    const calls: LogContext[] = []
    const recording: Logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: (_message, context) => {
        calls.push(context ?? {})
      },
      child: () => recording,
    }
    const app = express()
    app.use(requestContext(recording))
    app.use(() => {
      throw new Error('a bug, not a client mistake')
    })
    app.use(errorHandler())

    await request(app).get('/anything')
    return calls
  }

  it('is kept in the log, production included, so an operator can tell where the bug is', async () => {
    // P4-06 / docs/SECURITY.md A-36: a stack trace never reaches the client — the
    // response is always the opaque 500 above — so a production build that dropped it
    // from the log as well, as this handler used to, would cost the operator the one
    // thing that could have told them where the bug actually is.
    const [call] = await errorCallsFrom()

    expect(call?.['stack']).toContain('a bug, not a client mistake')
    expect(call?.['stack']).toContain('at ')
  })
})
