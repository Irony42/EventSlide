import cookieParser from 'cookie-parser'
import express, { type Express, type RequestHandler } from 'express'
import session from 'express-session'
import type { Store } from 'express-session'
import { accessLog } from './middleware/accessLog'
import { errorHandler, requestContext } from './middleware/errorHandler'
import { issueCsrfToken, requireCsrfToken } from './middleware/csrf'
import { attachUser, enforceSessionAge, requirePasswordCurrent } from './middleware/authz'
import {
  eventCreationLimiter,
  guestWriteLimiter,
  uploadConcurrencyLimiter,
  uploadLimiter,
} from './middleware/rateLimit'
import { permissionsPolicy, securityHeaders } from './middleware/securityHeaders'
import { aboutRoutes } from './routes/aboutRoutes'
import { authRoutes } from './routes/authRoutes'
import { clientRoutes } from './routes/clientRoutes'
import { invitationRoutes } from './routes/invitationRoutes'
import { clipRoutes } from './routes/clipRoutes'
import { eventRoutes } from './routes/eventRoutes'
import { galleryHeaders, galleryRoutes, setGalleryHeaders } from './routes/galleryRoutes'
import { guestRoutes } from './routes/guestRoutes'
import { healthRoutes, type HealthChecks } from './routes/healthRoutes'
import { mediaRoutes } from './routes/mediaRoutes'
import { meRoutes } from './routes/meRoutes'
import { missionRoutes } from './routes/missionRoutes'
import { moderationRoutes } from './routes/moderationRoutes'
import { privacyNoticeRoutes } from './routes/privacyNoticeRoutes'
import { publicRoutes } from './routes/publicRoutes'
import { shareLinkRoutes } from './routes/shareLinkRoutes'
import { siteRoutes } from './routes/siteRoutes'
import { streamRoutes } from './routes/streamRoutes'
import type { AboutFacts } from './presenters/aboutPresenter'
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
  /** The running build's version and where its source is: `GET /api/about`. */
  readonly about: AboutFacts
  readonly presenter: PresenterContext
  /** Where the built web app lives, when there is one. Absent in tests. */
  readonly clientDir?: string
}

export const buildServer = ({
  deps,
  usecases,
  sessionStore,
  health,
  about,
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

  // One line per finished request: the route pattern, the status, the duration and the
  // request id — never the real path, a header or a body. Right after `requestContext`
  // (docs/ARCHITECTURE.md §4.2), so it logs every request this process answers, probes
  // included, and so `req.context.requestId` already exists when it reads it.
  app.use(accessLog(config.accessLog))

  // Liveness and readiness, before the body parser, the cookie parser and the session:
  // a probe is a machine with no cookie jar, and one that does happen to carry a stale
  // `es_session` must not be answered by way of the session store. An unusable store
  // would otherwise make liveness fail for a reason liveness is not about, and a 500
  // from liveness is a container restart — mid-event, that drops every in-flight
  // upload. Being ahead of the CSRF gate follows from the same position.
  app.use('/api', healthRoutes(health))

  // What this box is and where its source is — the machine-readable half of the AGPL
  // section 13 offer — in the same position and for the same reasons: ahead of the body
  // parser, the cookie parser, the session and the CSRF gate. A first visit is a phone
  // with no cookie jar, one that does carry a stale `es_session` must not be answered by
  // way of the store, and neither costs the box a session row. `aboutRoutes.test.ts` observes both.
  //
  // `siteAdmin` is read from the same `config` that decides whether `/api/site` is mounted
  // below, so the flag the SPA reads cannot disagree with the mount it stands for.
  app.use(
    '/api',
    aboutRoutes(about, { siteAdmin: config.siteAdmin, forgotPassword: deps.mailer.canDeliver }),
  )

  // The shared gallery's headers, ahead of everything that can refuse a request before
  // its router is reached — the body parser, the session, the CSRF gate. The token is in
  // these paths, so a `400` for a malformed body or a `403` for a missing CSRF token
  // needs `no-referrer`, `noindex` and `no-store` exactly as much as the album does.
  // Two mounts, because a mount path matches at a `/` boundary and `/api/gallery` does
  // not cover `/api/gallery-media`.
  app.use(['/api/gallery', '/api/gallery-media'], galleryHeaders)

  // Bounded well below any legitimate payload: the only JSON bodies here are a login,
  // a caption and a list of at most 200 photo ids. Uploads go through multer.
  app.use(express.json({ limit: '64kb' }))
  // Express 5 leaves `req.body` **undefined** when no parser read a body — a request with
  // none, or one whose type `express.json` does not take — where Express 4 left `{}`.
  // Every handler parses `req.body` with a zod schema, and `{}` fails it field by field
  // while `undefined` fails it once, at the root, naming none: `POST /api/join` with no
  // body answered `details.fields: "joinCode"` and would answer `""`, which is not what
  // docs/API.md §1 promises. Worse, `shareLinkBody` and `updateSettingsBody` accept `{}` and
  // refuse `undefined`, so a body-less `POST /api/events/:slug/share-link` would be a 400 where
  // it used to make the link. Restoring the empty object keeps both answers. Multer, on the
  // upload routes, sets its own `req.body` after this.
  app.use((req, _res, next) => {
    req.body ??= {}
    next()
  })
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

  // Issues a token to a caller who holds none. It never replaces one, so that a client
  // holding a valid token keeps it across every ordinary request; the two moments the
  // token *must* change — a login and a logout, where the identity it travels beside
  // changes — call `rotateCsrfToken` from inside `authRoutes` instead.
  app.use(issueCsrfToken({ secureCookie: config.secureCookie }))
  // Ahead of `attachUser`, so a session past its absolute lifetime is gone before there
  // is an identity to resolve from it. `rolling: true` above is an idle timeout and the
  // store pushes the deadline forward on every request; without this, a session that is
  // being used has no end at all.
  app.use(enforceSessionAge(deps))
  app.use(attachUser())

  // The server-side half of `mustChangePassword` (P3-03): a signed-in account that must
  // choose a password meets `403 auth.passwordChangeRequired` on every `/api` route but
  // three (`authz.ts`'s own doc comment names them and why). After identity is resolved,
  // so there is a principal to ask about, and ahead of every router — including the CSRF
  // gate below, so a stuck session is told why before it is told its token is stale.
  app.use('/api', requirePasswordCurrent(deps))

  // Every state-changing request from here on must echo the CSRF cookie. Mounted ahead
  // of every router, which is what lets the client retry a `request.csrfMismatch` once
  // without asking whether the first attempt had an effect: it cannot have had one.
  app.use('/api', requireCsrfToken)

  const routeDeps = { deps, usecases, presenter }

  // The operator's namespace (roadmap §10.9), and only on a box that asked for it.
  //
  // **Off, it is not mounted at all** — not mounted and refusing, not mounted and hidden.
  // Every `/api/site` path then falls through to `apiNotFound` below and answers the same
  // status, body and headers as any path nobody wrote: a box that never asked for
  // administration exposes no operator surface, not even a gate. The mode itself is no
  // secret — on answers 401 where off answers 404 — and nothing relies on it being one.
  //
  // **On, `requireOperator` guards the whole mount point** from inside `siteRoutes`: 401
  // with no session, 403 for an account that does not operate the box, and an operator on
  // a path no route claims falls through to the same `apiNotFound`.
  //
  // After the CSRF gate and `attachUser`, so a mutating request is proven same-origin
  // before anything else is asked of it and the gate has an identity to read. **First of
  // the routers behind that gate**, so a request that reaches this mount meets the operator
  // check before any `/api` router below sees it. Ordering cannot cover a request that
  // never reaches the mount: `GET /api//site/x` matches only `/api`, whose routers are
  // handed `//site/x` (Express 4 handed them `/site/x`), so a route written `//site/…` in
  // the wrong file would answer it ungated, and one written `/site/…` would answer
  // `/api/site/x` with this switch off. What keeps the namespace this router's alone is the
  // structural case in `siteOperatorScope.test.ts`, which fails, in both modes, on any route
  // at `/api/site` or `/api/site/*` that another router declares — and whose walk of the
  // route table refuses to guess: a route path that is anything but literal segments and
  // `:parameters` (`/s{1}ite/x`, `/sit\e/x`, `/*splat`, `/{site}/x`), a middleware
  // mounted at a path inside a router, or a sub-app makes it fail loudly, because each can
  // answer `/api/site/x` without spelling `/site` where a walk could read it.
  // (Collapsing `//` app-wide would close the request side as well. It is deliberately not
  // done: while that walk holds, the double slash reaches no route in this namespace, only
  // `apiNotFound`.)
  if (config.siteAdmin) {
    app.use('/api/site', siteRoutes(routeDeps))
  }

  // The client's own space (roadmap §10.9): with the operator's namespace, not without it. A
  // box that never asked for administration has no clients, nothing waits for an owner, and
  // every path here is an unknown route, as `/api/site` is.
  if (config.siteAdmin) {
    app.use('/api', clientRoutes(routeDeps))
    // What a signed-in account reads of its own clients' limits (G2-16 / P3-17): the same
    // surface, so the same switch.
    app.use('/api', meRoutes(routeDeps))
  }

  app.use('/api', publicRoutes(routeDeps))
  app.use('/api', authRoutes(routeDeps))
  // The invitee's side of an invitation link: what it offers, and accepting it. Public, and
  // after the auth routes because accepting with a password starts a session the same way a
  // sign-in does.
  app.use('/api', invitationRoutes(routeDeps))

  /**
   * **One upload bucket, built here and shared by both upload routes.**
   *
   * `express-rate-limit` gives every call its own `MemoryStore`, so calling
   * `uploadLimiter(...)` inside each router was two independent allowances wearing one
   * configuration key: a guest who had spent `UPLOAD_RATE_LIMIT_PER_MINUTE` on
   * photographs still had the whole of it again for clips. A guest sending both is one
   * guest, and the limit is meant to be what the variable says it is.
   */
  const uploadRateLimiter = uploadLimiter(config.rateLimits.uploadPerMinute)

  /**
   * **One bucket for the guest's other writes (HTTP-H-01), same reason, same arrangement.**
   *
   * A caption, taking a photo back, withdrawing a reaction and acknowledging the privacy
   * notice are four routes in two routers and one guest; built inside each router they would
   * be two allowances under `GUEST_WRITE_RATE_LIMIT_PER_MINUTE`.
   */
  const guestWriteRateLimiter = guestWriteLimiter(config.rateLimits.guestWritePerMinute)

  /**
   * **The upload concurrency semaphore (G3-06 / P4-10), same reason, same arrangement.**
   *
   * A counter closed over by the middleware function itself, so calling
   * `uploadConcurrencyLimiter(...)` inside each router would have been two independent
   * counters under one configuration name — exactly the defect `uploadRateLimiter`
   * above already exists to avoid, for the same two routes.
   */
  const sharedUploadConcurrencyLimiter = uploadConcurrencyLimiter(
    config.uploads.maxConcurrentRequests,
  )

  app.use(
    '/api',
    guestRoutes({
      ...routeDeps,
      uploadRateLimiter,
      guestWriteRateLimiter,
      uploadConcurrencyLimiter: sharedUploadConcurrencyLimiter,
    }),
  )
  // Its own router, its own multer, its own byte limit — see `clipRoutes.ts`. Mounted
  // beside the guest routes rather than inside them so that neither upload path can
  // inherit the other's parser by accident.
  app.use(
    '/api',
    clipRoutes({
      deps,
      usecases,
      uploadTempDir: config.clips.uploadTempDir,
      maxClipBytes: config.clips.maxBytes,
      uploadRateLimiter,
      uploadConcurrencyLimiter: sharedUploadConcurrencyLimiter,
    }),
  )
  // The privacy notice a guest reads before their first upload (roadmap §5.1). Its own
  // path under the event, so where it sits among the routers is for reading order only.
  app.use('/api', privacyNoticeRoutes({ ...routeDeps, guestWriteRateLimiter }))
  app.use('/api', mediaRoutes(routeDeps))
  // The shared gallery (roadmap §4.1): public, token-gated, with its own limits and its
  // own headers. Its own router so that nothing mounted for the host's surface — a role
  // check, a cache header — can be inherited by the one surface a stranger reaches.
  app.use('/api', galleryRoutes({ deps, usecases, limits: config.rateLimits }))
  app.use('/api', shareLinkRoutes(routeDeps))
  app.use('/api', moderationRoutes(routeDeps))
  // After the guest router, which owns 'missions/mine' on the same path prefix, and
  // before the event router for no reason other than reading order: the four routes here
  // are all 'events/:eventSlug/missions' and none of them collides with anything above.
  app.use('/api', missionRoutes(routeDeps))
  app.use(
    '/api',
    eventRoutes({
      ...routeDeps,
      // Its own limiter, not a share of `uploadRateLimiter`: event creation is a host
      // action gated behind a session, not a public write a stranger can reach, and it
      // is keyed by account rather than by address (P4-09 / D-14).
      creationLimiter: eventCreationLimiter(config.rateLimits.eventCreationPerHour),
    }),
  )
  app.use('/api', streamRoutes(deps))

  // An unmatched /api path is a 404 in the API's own error shape, not the HTML the
  // SPA fallback below would otherwise return — a client parsing that as JSON gets a
  // confusing failure instead of a clear one.
  app.use('/api', apiNotFound)

  if (clientDir !== undefined) {
    mountClient(app, clientDir, config.isProduction)
  }

  // Last, so everything above can throw into it.
  app.use(errorHandler())

  return app
}

const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: { code: 'route.notFound', message: 'No such endpoint', details: {} },
  })
}

/**
 * The **pages** a mailed link opens, whose last segment is a one-time credential: an
 * invitation and a password reset. Two families, and two of the five `loggablePath` redacts
 * in a log line (`TOKEN_IN_PATH`, `middleware/errorHandler.ts`). The other three are not in
 * this list on purpose: the shared gallery's page, `/g`, is mounted just above with the same
 * headers, and `/api/gallery/<token>/…` and `/api/invitations/<token>/…` are API routes, not
 * pages, so they have no shell to serve.
 */
const TOKEN_PAGES = ['/invite', '/invite/*splat', '/password/reset', '/password/reset/*splat']

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
      // Said rather than inherited. Express 4 only looked at the last segment of a path, so
      // `/.hidden/file.txt` was served from inside the client directory; Express 5 refuses
      // a dot-directory anywhere in it, and a request for one falls through to the SPA
      // shell. Nothing here ships a dotfile, and nothing should start to by default. A test
      // holds the behaviour, not this line: the line only keeps a later default from
      // deciding it.
      dotfiles: 'ignore',
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

  // The shared gallery's page. The same shell, with the gallery's headers: the token is
  // in this address, so no referrer may carry it off, no crawler may index it and no
  // cache may keep the page it opened. `no-store` rather than the shell's `no-cache`.
  app.get(['/g', '/g/*splat'], (_req, res) => {
    setGalleryHeaders(res)
    res.sendFile('index.html', { root: clientDir, headers: { 'Cache-Control': 'no-store' } })
  })

  // The pages a mailed link opens (G2-10): an invitation, `/invite/<token>`, and a password
  // reset, `/password/reset/<token>`. The same shell with the same headers as the gallery's, for
  // the same reason — the token is in this address, so no referrer may carry it off, no crawler
  // may index it and no cache may keep the page it opened. `/password/forgot` carries no token
  // and is an ordinary client route. A string pattern, like the gallery's, so that the access log
  // names the route (`/invite/*splat`) instead of `(unmatched)`; Express matches it without regard
  // to case, so `/INVITE/<token>` gets the same headers as it reaches the same page.
  app.get(TOKEN_PAGES, (_req, res) => {
    setGalleryHeaders(res)
    res.sendFile('index.html', { root: clientDir, headers: { 'Cache-Control': 'no-store' } })
  })

  // The SPA fallback. Everything that is not /api and not a file is a client route:
  // /join/:code, /e/:slug/display, /admin/**.
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next()
      return
    }
    res.sendFile('index.html', { root: clientDir, headers: { 'Cache-Control': 'no-cache' } })
  })
}
