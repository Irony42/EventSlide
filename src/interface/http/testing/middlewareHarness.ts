import { tmpdir } from 'node:os'
import { join } from 'node:path'
import cookieParser from 'cookie-parser'
import express, { type Express, type RequestHandler } from 'express'
import session from 'express-session'
import { FakeClock } from '../../../application/testing/fakeClock'
import { FakeEventRepository } from '../../../application/testing/fakeEventRepository'
import { FakeGuestRepository } from '../../../application/testing/fakeGuestRepository'
import { FakeMembershipRepository } from '../../../application/testing/fakeMembershipRepository'
import { RecordingEventBus } from '../../../application/testing/recordingEventBus'
import { AT } from '../../../application/testing/builders'
import { asEventId, asGuestId } from '../../../domain/shared/ids'
import { createHmacGuestTokenService } from '../../../infrastructure/crypto/hmacGuestTokenService'
import { silentLogger } from '../../../infrastructure/logging/pinoLogger'
import { errorHandler, requestContext } from '../middleware/errorHandler'
import { attachUser } from '../middleware/authz'
import type { HttpConfig, HttpDeps, SessionPayload } from '../types'

/**
 * A minimal Express app wrapping only the middleware under test.
 *
 * The point of `buildServer(deps)` never calling `listen()` is that the HTTP surface
 * can be exercised with supertest and no open port; this harness is the same idea one
 * level down, so a middleware can be tested without the whole route table.
 *
 * The infrastructure used here is real where it is cheap and honest — the HMAC token
 * service, cookie parsing, session handling — and faked only at the repository
 * boundary. A fake token service would test nothing, since forging a token is exactly
 * what the middleware exists to prevent.
 */

export const TEST_GUEST_SECRET = 'harness-guest-token-secret-at-least-32-chars'
export const TEST_SESSION_SECRET = 'harness-session-secret-at-least-32-characters'

export const testHttpConfig = (overrides: Partial<HttpConfig> = {}): HttpConfig => ({
  isProduction: false,
  publicUrl: 'http://localhost:4300',
  trustProxyHops: 0,
  sessionSecret: TEST_SESSION_SECRET,
  secureCookie: false,
  e2eHooks: false,
  uploads: { maxBytes: 25_000_000, maxFiles: 20 },
  // A clip carries its own limit and its own temp directory. The photo path's ceiling
  // feeds a per-request heap calculation the deployment's memory limit was reasoned
  // against, so the two deliberately do not share one number.
  clips: { maxBytes: 80_000_000, uploadTempDir: join(tmpdir(), 'eventslide-test-clips') },
  rateLimits: {
    uploadPerMinute: 12,
    joinPerMinute: 20,
    loginPerMinute: 10,
    reactionPerMinute: 30,
  },
  ...overrides,
})

/**
 * The dependencies an HTTP test drives, plus the fakes behind them.
 *
 * Separated from {@link Harness} because two harnesses need exactly this world: the
 * middleware one below, which wraps a handful of handlers, and the server one in
 * `serverHarness.ts`, which drives the real `buildServer()`. Building it twice would
 * let the two drift, and a middleware test passing against a world the real server
 * never assembles is the kind of gap this file exists to close.
 */
export interface TestWorld {
  readonly deps: HttpDeps
  readonly events: FakeEventRepository
  readonly guests: FakeGuestRepository
  readonly memberships: FakeMembershipRepository
  readonly bus: RecordingEventBus
  readonly clock: FakeClock
  /** Issues a real, correctly signed guest token for the given event and guest. */
  issueGuestToken(eventId: string, guestId: string): string
}

export interface Harness extends TestWorld {
  readonly app: Express
}

/** The fakes and ports, with no Express app around them. */
export const buildTestWorld = (config: Partial<HttpConfig> = {}): TestWorld => {
  const clock = new FakeClock(AT)
  const events = new FakeEventRepository()
  const guests = new FakeGuestRepository()
  const memberships = new FakeMembershipRepository()
  const bus = new RecordingEventBus()
  const logger = silentLogger()
  const guestTokens = createHmacGuestTokenService({ secret: TEST_GUEST_SECRET })

  const deps: HttpDeps = {
    clock,
    logger,
    bus,
    events,
    guests,
    memberships,
    guestTokens,
    config: testHttpConfig(config),
  }

  return {
    deps,
    events,
    guests,
    memberships,
    bus,
    clock,
    issueGuestToken: (eventId, guestId) =>
      guestTokens.issue({
        // The harness deals in plain strings, so the sanctioned id casts belong here —
        // this is the same boundary at which a repository maps a row into the domain.
        eventId: asEventId(eventId),
        guestId: asGuestId(guestId),
        issuedAt: clock.now(),
      }),
  }
}

export interface HarnessOptions {
  readonly config?: Partial<HttpConfig>
  /**
   * Wires the routes under test. Receives the harness's deps plus a helper that logs a
   * fake user in, so a test does not have to drive a real login to reach an
   * authenticated route.
   */
  readonly routes: (app: Express, deps: HttpDeps) => void
  /**
   * Whether to mount `express-session`. On by default, because almost every route
   * needs a principal.
   *
   * Turning it off is how a test reaches the case `attachUser` guards against: identity
   * resolution running where no session exists at all. `server.ts` always mounts the
   * session first, so that ordering can only be broken by a future edit — and the
   * failure it would cause is a `TypeError` answered as a 500 on a public route, which
   * is worth one test rather than one `?.`.
   */
  readonly withSession?: boolean
}

/** Signs a session in, for tests that need an authenticated caller. */
export const signInAs =
  (payload: SessionPayload): RequestHandler =>
  (req, res) => {
    Object.assign(req.session as unknown as SessionPayload, payload)
    res.status(204).end()
  }

export const buildHarness = ({
  config = {},
  routes,
  withSession = true,
}: HarnessOptions): Harness => {
  const world = buildTestWorld(config)
  const { deps } = world
  const httpConfig = deps.config
  const logger = deps.logger

  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  if (withSession) {
    app.use(
      session({
        secret: httpConfig.sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: { httpOnly: true, sameSite: 'lax', secure: httpConfig.secureCookie },
      }),
    )
  }
  app.use(requestContext(logger))
  app.use(attachUser())

  routes(app, deps)

  app.use(errorHandler(httpConfig.isProduction))

  return { app, ...world }
}
