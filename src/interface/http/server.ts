import cookieParser from 'cookie-parser'
import express, { type Express, type RequestHandler } from 'express'
import session from 'express-session'
import type { Store } from 'express-session'
import { errorHandler, requestContext } from './middleware/errorHandler'
import { issueCsrfToken, requireCsrfToken } from './middleware/csrf'
import { attachUser } from './middleware/authz'
import { permissionsPolicy, securityHeaders } from './middleware/securityHeaders'
import { authRoutes } from './routes/authRoutes'
import { eventRoutes } from './routes/eventRoutes'
import { guestRoutes } from './routes/guestRoutes'
import { healthRoutes, type HealthChecks } from './routes/healthRoutes'
import { mediaRoutes } from './routes/mediaRoutes'
import { moderationRoutes } from './routes/moderationRoutes'
import { publicRoutes } from './routes/publicRoutes'
import { streamRoutes } from './routes/streamRoutes'
import type { HttpDeps } from './types'
import type { PresenterContext } from './presenters/presenters'
import type { HttpUseCases } from './useCases'

/**
 * Builds the Express app. **Never calls `listen()`.**
 *
 * That single constraint is what makes the whole HTTP surface testable with supertest
 * and no open port, which is why 1.0 had no HTTP tests at all: its `src/index.ts`
 * created the app and listened in the same module, so importing anything from it
 * started a server.
 *
 * `src/main/index.ts` is the only file that listens.
 */

export interface ServerOptions {
  readonly deps: HttpDeps
  readonly usecases: HttpUseCases
  readonly sessionStore: Store
  readonly health: HealthChecks
  readonly presenter: PresenterContext
  /** Where the built web app lives, when there is one. Absent in tests. */
  readonly clientDir?: string
}

export const buildServer = ({
  deps,
  usecases,
  sessionStore,
  health,
  presenter,
  clientDir,
}: ServerOptions): Express => {
  const app = express()
  const { config } = deps

  // Express trusts no proxy by default, so `req.ip` would be the proxy's address and
  // one guest's burst would rate-limit the whole venue. Set too high and a client can
  // spoof X-Forwarded-For past the limit — hence explicit configuration rather than
  // `trust proxy: true`.
  app.set('trust proxy', config.trustProxyHops)
  // Nothing needs the header, and it advertises the stack.
  app.disable('x-powered-by')
  // Two events differing only by trailing slash would otherwise be two cache entries.
  app.set('strict routing', false)

  app.use(securityHeaders(config.isProduction))
  app.use(permissionsPolicy)

  // Ahead of the body parser, so a request the parser refuses still has a request id
  // and a logger. Mounted after it, the one failure nobody can correlate to a log line
  // is a malformed body — the failure a client is most likely to be arguing about.
  app.use(requestContext(deps.logger))

  // Liveness and readiness, before the body parser, the cookie parser and the session:
  // a probe is a machine with no cookie jar, and one that does happen to carry a stale
  // `es_session` must not be answered by way of the session store. An unusable store
  // would otherwise make liveness fail for a reason liveness is not about, and a 500
  // from liveness is a container restart — mid-event, that drops every in-flight
  // upload. Being ahead of the CSRF gate follows from the same position.
  app.use('/api', healthRoutes(health))

  // Bounded well below any legitimate payload: the only JSON bodies here are a login,
  // a caption and a list of at most 200 photo ids. Uploads go through multer.
  app.use(express.json({ limit: '64kb' }))
  app.use(cookieParser())

  app.use(
    session({
      name: 'es_session',
      secret: config.sessionSecret,
      store: sessionStore,
      resave: false,
      // No session for an anonymous visitor: the wall and the join page are public,
      // and a row per projector refresh would be a slow leak.
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.secureCookie,
        path: '/',
        maxAge: 12 * 60 * 60 * 1000,
      },
    }),
  )

  app.use(issueCsrfToken({ secureCookie: config.secureCookie }))
  app.use(attachUser())

  // Every state-changing request from here on must echo the CSRF cookie.
  app.use('/api', requireCsrfToken)

  const routeDeps = { deps, usecases, presenter }
  app.use('/api', publicRoutes(routeDeps))
  app.use('/api', authRoutes(routeDeps))
  app.use('/api', guestRoutes(routeDeps))
  app.use('/api', mediaRoutes(routeDeps))
  app.use('/api', moderationRoutes(routeDeps))
  app.use('/api', eventRoutes(routeDeps))
  app.use('/api', streamRoutes(deps))

  // An unmatched /api path is a 404 in the API's own error shape, not the HTML the
  // SPA fallback below would otherwise return — a client parsing that as JSON gets a
  // confusing failure instead of a clear one.
  app.use('/api', apiNotFound)

  if (clientDir !== undefined) {
    mountClient(app, clientDir, config.isProduction)
  }

  // Last, so everything above can throw into it.
  app.use(errorHandler(config.isProduction))

  return app
}

const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: { code: 'route.notFound', message: 'No such endpoint', details: {} },
  })
}

/**
 * Serves the built web app.
 *
 * Assets are content-hashed by Vite, so they can be cached for a year; `index.html`
 * must never be, or a guest scanning the QR code after a deploy gets a page referencing
 * assets that no longer exist.
 */
const mountClient = (app: Express, clientDir: string, isProduction: boolean): void => {
  app.use(
    express.static(clientDir, {
      index: false,
      setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache')
          return
        }
        if (isProduction && /\.[0-9a-f]{8,}\./.test(path)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        }
      },
    }),
  )

  // The SPA fallback. Everything that is not /api and not a file is a client route:
  // /join/:code, /e/:slug/display, /admin/**.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next()
      return
    }
    res.sendFile('index.html', { root: clientDir, headers: { 'Cache-Control': 'no-cache' } })
  })
}
