import { randomUUID } from 'node:crypto'
import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError } from 'zod'
import { DomainError } from '../../../domain/shared/errors'
import type { Logger } from '../../../application/ports/logger'
import { errorBody, sendError, statusForKind } from '../presenters/send'

/**
 * Where a link's token sits in a path: a shared gallery's `/g/<token>` and
 * `/api/gallery/<token>/…`, a password-reset link's `/password/reset/<token>` (G2-08 /
 * P3-09 — the page the mailed link opens, served by the SPA fallback, so the path is
 * exactly what `requestContext` stamps on every line written while it is served), and an
 * invitation's `/invite/<token>` and `/api/invitations/<token>/…` (G2-09 / P3-10, the same
 * page and the routes it calls).
 * Case-insensitive, as Express's routing is — `/API/Gallery/<token>` reaches the same
 * route. `/api/gallery-media/…` does not match: it carries a link's id and a signature,
 * neither of which opens anything alone.
 */
const TOKEN_IN_PATH = /^(\/api\/gallery|\/g|\/password\/reset|\/invite|\/api\/invitations)\/[^/]+/i

/**
 * The request path as it may be logged: a link's token written as `:token`.
 *
 * That token is the credential itself — whoever reads a gallery's reads the album, whoever
 * reads a reset link's chooses the account's password, whoever reads an invitation's chooses
 * the password of an account that does not exist yet — and a log line is read by whoever
 * operates the box and by whatever ships its logs, long after the link was sent. Every
 * other path is logged as it is.
 */
export const loggablePath = (path: string): string => {
  // A doubled slash is how a request steps round an anchored pattern: `/api//invitations/<t>`
  // is routed exactly like `/api/invitations/<t>`. So the match is made on the path with its
  // slashes collapsed, and a path that carries no token is logged as it came.
  const collapsed = path.replace(/\/{2,}/g, '/')
  return TOKEN_IN_PATH.test(collapsed) ? collapsed.replace(TOKEN_IN_PATH, '$1/:token') : path
}

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
      logger: logger.child({ requestId, method: req.method, path: loggablePath(req.path) }),
    }
    next()
  }

/**
 * A zod failure describes which fields were wrong, without echoing their values.
 *
 * docs/API.md §1 promises "up to ten offending **paths**", so a path is named once however
 * many rules it broke. That was nearly always true under zod 3 and stopped being true
 * under zod 4, which keeps running the length rules on a value of the wrong type (`[]` for
 * a name is an `invalid_type` *and* a `too_small`): `name, name`, with a slot of the ten
 * spent on the repeat.
 *
 * A key is stringified rather than joined as it comes: zod 4 types a path as `PropertyKey[]`,
 * and `join` throws on a symbol. No JSON body or query string can carry one, which is the
 * only reason this has never been reachable.
 */
const fromZodError = (error: ZodError): DomainError =>
  DomainError.invalid('request.invalid', {
    fields: [
      ...new Set(
        error.issues
          .map((issue) => issue.path.map((key) => String(key)).join('.'))
          .filter((path) => path.length > 0),
      ),
    ]
      .slice(0, 10)
      .join(', '),
  })

/**
 * The last middleware. Everything that throws ends up here.
 *
 * Two rules:
 * - A `DomainError` is the expected shape and is returned as-is, at its mapped status.
 * - Anything else is a bug. It is logged in full, with the request id and the stack
 *   trace, and answered with an opaque 500. A stack trace, a SQL fragment or a
 *   filesystem path must never reach a guest's phone — but it belongs in the log
 *   whatever the environment, production included (P4-06 / docs/SECURITY.md A-36),
 *   because that response is always the same opaque 500 and an operator reading the log
 *   is the only reader left who can be told where the bug actually is.
 */
export const errorHandler = (): ErrorRequestHandler => (error, req, res, _next) => {
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

  // A path Express could not decode: the client's mistake, not ours. Logged as that, and
  // with nothing from the error itself — see `isUndecodablePath` for why not its message.
  if (isUndecodablePath(error)) {
    logger?.debug('request rejected', { code: 'request.invalid', kind: 'invalid', status: 400 })
    sendError(res, DomainError.invalid('request.invalid'))
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
    // In production too (P4-06 / docs/SECURITY.md A-36): a stack trace never reaches
    // the client — the response below is always the opaque 500 — so keeping it out of
    // the log as well just means an operator reads a message with nowhere in the code
    // it came from. This is the structured field a log shipper indexes and forwards.
    stack: error instanceof Error ? error.stack : undefined,
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
 * The router's refusal to decode a path: `/api/events/%E0%A4%A/wall`, `/g/%E0%A4%A`.
 *
 * Express decodes a route parameter or a wildcard itself, before any handler runs, with
 * `decodeURIComponent`. When that throws, the router stamps the `URIError` with
 * `status: 400` and passes it on. A request whose path is not valid percent-encoding is
 * the client's mistake — a link cut in the middle of an escape — so it is a
 * `400 request.invalid`, the answer a body that is not JSON already gets.
 *
 * **Recognised by both**, the class and the `400` the router stamped. A `URIError` on its
 * own is also what a handler of ours gets from calling `decodeURIComponent` on a header, and
 * that is a bug here: it has no `status`, so it stays the opaque 500 with its stack in the
 * log. The same care as `bodyParserToDomain` takes, from the other side.
 *
 * **Nothing from the error is ever logged or sent.** Its message is `Failed to decode param
 * '<the raw parameter>'`, and on a gallery, invitation or password-reset path the parameter
 * is the credential: a link cut half way through an escape (`/g/<token>%E2%80`) used to put
 * the whole token into the error log through exactly this line. `loggablePath` hides the
 * token in the path binding, and this is what keeps it out of the message.
 */
const isUndecodablePath = (error: unknown): boolean =>
  error instanceof URIError && (error as { status?: unknown }).status === 400

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
