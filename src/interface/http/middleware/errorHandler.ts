import { randomUUID } from 'node:crypto'
import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError } from 'zod'
import { DomainError } from '../../../domain/shared/errors'
import type { Logger } from '../../../application/ports/logger'
import { errorBody, sendError, statusForKind } from '../presenters/send'

/**
 * Attaches a request id and a child logger before anything else runs.
 *
 * The id is echoed in the `X-Request-Id` response header and appears on every log line
 * for the request, so a host who reports "the upload failed at about nine" can be
 * answered from the logs. 1.0 logged with `console.log` and interpolated strings, so
 * there was nothing to correlate on at all.
 */
export const requestContext =
  (logger: Logger): RequestHandler =>
  (req, res, next) => {
    // A client-supplied id is accepted only in a bounded, safe form: it is useful
    // behind a proxy that already generates one, and it must not be able to inject
    // newlines into a log line or unbounded text into memory.
    const supplied = req.get('x-request-id')
    const requestId =
      supplied !== undefined && /^[A-Za-z0-9_-]{1,64}$/.test(supplied) ? supplied : randomUUID()

    res.setHeader('x-request-id', requestId)
    req.context = {
      requestId,
      logger: logger.child({ requestId, method: req.method, path: req.path }),
    }
    next()
  }

/** A zod failure describes which fields were wrong, without echoing their values. */
const fromZodError = (error: ZodError): DomainError =>
  DomainError.invalid('request.invalid', {
    fields: error.issues
      .map((issue) => issue.path.join('.'))
      .filter((path) => path.length > 0)
      .slice(0, 10)
      .join(', '),
  })

/**
 * The last middleware. Everything that throws ends up here.
 *
 * Two rules:
 * - A `DomainError` is the expected shape and is returned as-is, at its mapped status.
 * - Anything else is a bug. It is logged in full, with the request id, and answered
 *   with an opaque 500. A stack trace, a SQL fragment or a filesystem path must never
 *   reach a guest's phone.
 */
export const errorHandler =
  (isProduction: boolean): ErrorRequestHandler =>
  (error, req, res, _next) => {
    const logger = req.context?.logger

    if (error instanceof ZodError) {
      sendError(res, fromZodError(error))
      return
    }

    if (DomainError.is(error)) {
      // A 5xx from the domain still means something went wrong internally, so it is
      // logged at error level; a 4xx is the client's problem and only worth debug.
      const status = statusForKind(error.kind)
      const payload = { code: error.code, kind: error.kind, status }
      if (status >= 500) logger?.error('request failed', payload)
      else logger?.debug('request rejected', payload)

      sendError(res, error)
      return
    }

    // Multer's own errors arrive as plain Errors with a `code`.
    if (isMulterError(error)) {
      sendError(res, multerToDomain(error))
      return
    }

    // `express.json` refuses a body before any route runs, and its failures are the
    // client's problem: a body over the limit, or one that is not JSON at all. Left
    // untranslated they fall through to the opaque 500 below, which tells a client with
    // a bad body that the server is broken and files every one of them in the error log,
    // so a burst of malformed requests reads exactly like an outage.
    const bodyFailure = bodyParserToDomain(error)
    if (bodyFailure !== null) {
      logger?.debug('request body rejected', { code: bodyFailure.code, kind: bodyFailure.kind })
      sendError(res, bodyFailure)
      return
    }

    logger?.error('unhandled error', {
      error: error instanceof Error ? error.message : String(error),
      // Only in development: a stack trace in a production log is fine, but this is
      // the structured field a log shipper would index and forward.
      ...(isProduction ? {} : { stack: error instanceof Error ? error.stack : undefined }),
    })

    if (res.headersSent) {
      // A failure part-way through a streamed response — a ZIP export, an SSE frame.
      // The status is long gone; destroying the socket is the only honest signal that
      // the body is incomplete.
      res.destroy()
      return
    }

    res
      .status(500)
      .json(
        errorBody(
          DomainError.unexpected('server.unexpected', { requestId: req.context?.requestId ?? '' }),
        ),
      )
  }

/**
 * body-parser's own refusals, recognised by the `type` it stamps on every one of them.
 *
 * Recognised by `type` rather than by `status`: `status` is set by `http-errors` on
 * anything a library chose to throw with one, so keying on it would quietly re-map a
 * genuine internal failure from some other dependency into a 4xx and hide a bug.
 *
 * `entity.too.large` is a deliberate limit stopping the action, which is the
 * `quotaExceeded` kind (413). Everything else here is a body that could not be parsed
 * into valid values, which is `invalid` (400) — including `request.aborted`, where the
 * client has already gone and only the log line matters.
 */
const BODY_PARSER_TYPES: ReadonlyMap<string, () => DomainError> = new Map([
  ['entity.too.large', () => DomainError.quotaExceeded('request.tooLarge')],
  ['entity.parse.failed', () => DomainError.invalid('request.invalid')],
  ['entity.verify.failed', () => DomainError.invalid('request.invalid')],
  ['charset.unsupported', () => DomainError.invalid('request.invalid')],
  ['encoding.unsupported', () => DomainError.invalid('request.invalid')],
  ['parameters.too.many', () => DomainError.invalid('request.invalid')],
  ['request.aborted', () => DomainError.invalid('request.invalid')],
  ['request.size.invalid', () => DomainError.invalid('request.invalid')],
  ['stream.encoding.set', () => DomainError.invalid('request.invalid')],
  ['stream.not.readable', () => DomainError.invalid('request.invalid')],
])

const bodyParserToDomain = (error: unknown): DomainError | null => {
  if (!(error instanceof Error)) return null
  const type: unknown = (error as { type?: unknown }).type
  if (typeof type !== 'string') return null
  return BODY_PARSER_TYPES.get(type)?.() ?? null
}

interface MulterLikeError extends Error {
  readonly code: string
}

const MULTER_CODES = new Set([
  'LIMIT_FILE_SIZE',
  'LIMIT_FILE_COUNT',
  'LIMIT_UNEXPECTED_FILE',
  'LIMIT_PART_COUNT',
  'LIMIT_FIELD_COUNT',
  'LIMIT_FIELD_KEY',
  'LIMIT_FIELD_VALUE',
])

const isMulterError = (error: unknown): error is MulterLikeError =>
  error instanceof Error &&
  'code' in error &&
  typeof (error as { code?: unknown }).code === 'string' &&
  MULTER_CODES.has((error as { code: string }).code)

/**
 * Multer rejects an oversized upload before any of our code runs, so its errors have
 * to be translated here rather than in the upload use case.
 */
const multerToDomain = (error: MulterLikeError): DomainError => {
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return DomainError.quotaExceeded('upload.tooLarge')
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_PART_COUNT':
      return DomainError.invalid('upload.tooManyFiles')
    case 'LIMIT_UNEXPECTED_FILE':
      return DomainError.invalid('upload.unexpectedField')
    default:
      return DomainError.invalid('upload.rejected')
  }
}
