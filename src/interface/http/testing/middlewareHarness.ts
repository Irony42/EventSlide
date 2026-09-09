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
  rateLimits: {
    uploadPerMinute: 12,
    joinPerMinute: 20,
    loginPerMinute: 10,
    reactionPerMinute: 30,
  },
  ...overrides,
})

export interface Harness {
  readonly app: Express
  readonly deps: HttpDeps
  readonly events: FakeEventRepository
  readonly guests: FakeGuestRepository
  readonly memberships: FakeMembershipRepository
  readonly bus: RecordingEventBus
  readonly clock: FakeClock
  /** Issues a real, correctly signed guest token for the given event and guest. */
  issueGuestToken(eventId: string, guestId: string): string
}

export interface HarnessOptions {
  readonly config?: Partial<HttpConfig>
  /**
   * Wires the routes under test. Receives the harness's deps plus a helper that logs a
   * fake user in, so a test does not have to drive a real login to reach an
   * authenticated route.
   */
  readonly routes: (app: Express, deps: HttpDeps) => void
}

/** Signs a session in, for tests that need an authenticated caller. */
export const signInAs =
  (payload: SessionPayload): RequestHandler =>
  (req, res) => {
    Object.assign(req.session as unknown as SessionPayload, payload)
    res.status(204).end()
  }

export const buildHarness = ({ config = {}, routes }: HarnessOptions): Harness => {
  const clock = new FakeClock(AT)
  const events = new FakeEventRepository()
  const guests = new FakeGuestRepository()
  const memberships = new FakeMembershipRepository()
  const bus = new RecordingEventBus()
  const logger = silentLogger()
  const guestTokens = createHmacGuestTokenService({ secret: TEST_GUEST_SECRET })
  const httpConfig = testHttpConfig(config)

  const deps: HttpDeps = {
    clock,
    logger,
    bus,
    events,
    guests,
    memberships,
    guestTokens,
    config: httpConfig,
  }

  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use(
    session({
      secret: httpConfig.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', secure: httpConfig.secureCookie },
    }),
  )
  app.use(requestContext(logger))
  app.use(attachUser())

  routes(app, deps)

  app.use(errorHandler(httpConfig.isProduction))

  return {
    app,
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
