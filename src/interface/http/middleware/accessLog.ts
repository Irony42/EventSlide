import pinoHttp from 'pino-http'
import pino from 'pino'
import type { Request, RequestHandler, Response } from 'express'

/**
 * One structured line per request: the route **pattern**, the status, the duration and
 * the request id — never the real path, a query string, a header or a body.
 *
 * `pino-http` is already a dependency and was never imported before this (docs/SECURITY.md
 * A-36): nothing correlated a slow or failing request to a line in the log. This adapter
 * is deliberately an allow-list rather than a redaction list — unlike
 * `infrastructure/logging/pinoLogger.ts`, which redacts named fields out of whatever an
 * application log line happens to carry, this one never receives the request's path,
 * headers or body at all, so there is nothing to redact. `testing/logCanary.ts` is the
 * sweep that proves it: every mounted route, called with a gallery token, a join code, a
 * slug, a caption, an email, a password and a cookie in the path, the query, the headers
 * and the body, produces no log line that contains any of them.
 *
 * Must be mounted **after** `requestContext` (docs/ARCHITECTURE.md §4.2: `requestContext`
 * then `accessLog`), so `req.context.requestId` already exists by the time this records
 * — and the route pattern is read when the response finishes, by which point Express has
 * set `req.route` and `req.baseUrl` to whatever actually matched, however deep the request
 * went.
 */

export type AccessLogOptions =
  | { readonly enabled: false }
  | {
      readonly enabled: true
      readonly level: pino.Level
      readonly pretty: boolean
      /** Carried on every access-log line, so a shipper can tell one box's lines from another's. */
      readonly service: string
      readonly version: string
      readonly instance: string
    }

/** What `req.route.path` holds once Express has matched a route: one literal path, or several. */
const routePathOf = (req: Request): string | readonly string[] | undefined => {
  const route: unknown = req.route
  if (typeof route !== 'object' || route === null) return undefined
  const path: unknown = (route as Record<string, unknown>)['path']
  if (typeof path === 'string') return path
  if (Array.isArray(path) && path.every((segment): segment is string => typeof segment === 'string')) {
    return path
  }
  return undefined
}

/**
 * The route pattern a finished request matched, joined to the router it matched under —
 * `/api` + `/events/:eventSlug/stream`, never `/api/events/mariage-2026/stream`.
 *
 * A request that never reached a route — refused by the body parser, by CSRF, or simply
 * aimed at nothing — has no `req.route` at all. `'(unmatched)'` says so without echoing
 * whatever the caller sent.
 */
export const routePatternFor = (req: Request): string => {
  const path = routePathOf(req)
  if (path === undefined) return '(unmatched)'
  const pattern = Array.isArray(path) ? path.join('|') : path
  if (pattern === '/') return req.baseUrl === '' ? '/' : req.baseUrl
  return `${req.baseUrl}${pattern}`
}

const levelForStatus = (statusCode: number): pino.Level => {
  if (statusCode >= 500) return 'error'
  if (statusCode >= 400) return 'warn'
  return 'info'
}

/** A no-op middleware, so a disabled access log costs nothing: no pino instance, no output. */
const disabled: RequestHandler = (_req, _res, next) => {
  next()
}

export const accessLog = (options: AccessLogOptions): RequestHandler => {
  if (!options.enabled) return disabled

  const { level, pretty, service, version, instance } = options

  return pinoHttp<Request, Response>({
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
          },
        }
      : {}),
    // Replaces pino-http's defaults for both keys, which otherwise carry the raw URL
    // (query string included) and every header — including `cookie` and `authorization`
    // on the request, and `set-cookie` on the response, which is precisely how a fresh
    // session id would otherwise leave the process in a log line nobody meant to write.
    serializers: {
      req: (req: Request) => ({ method: req.method }),
      res: (res: Response) => ({ statusCode: res.statusCode }),
    },
    customAttributeKeys: { responseTime: 'duration' },
    customProps: (req: Request) => ({
      service,
      version,
      instance,
      requestId: req.context.requestId,
      route: routePatternFor(req),
    }),
    customLogLevel: (_req, res) => levelForStatus(res.statusCode),
    customSuccessMessage: (req, res) => `${req.method} ${routePatternFor(req)} ${res.statusCode}`,
    customErrorMessage: (req, res) => `${req.method} ${routePatternFor(req)} ${res.statusCode}`,
  })
}
