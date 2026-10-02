import type { RequestHandler } from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { SESSION_COOKIE, authRoutes } from './authRoutes'
import { ABSOLUTE_SESSION_LIFETIME_MS, GUEST_COOKIE } from '../middleware/authz'
import { CSRF_COOKIE, CSRF_HEADER, issueCsrfToken, requireCsrfToken } from '../middleware/csrf'
import { buildHarness, signInAs, testHttpConfig, type Harness } from '../testing/middlewareHarness'
import type { HttpConfig } from '../types'
import { AT, aUser } from '../../../application/testing/builders'
import { FakeUserRepository } from '../../../application/testing/fakeUserRepository'
import type { PasswordHasher } from '../../../application/ports/passwordHasher'
import { makeAuthenticateUser } from '../../../application/usecases/auth/authenticateUser'
import { makeChangePassword } from '../../../application/usecases/auth/changePassword'
import { makeRequestPasswordReset } from '../../../application/usecases/auth/requestPasswordReset'
import { makeResetPassword } from '../../../application/usecases/auth/resetPassword'
import { makeRevokeOtherSessions } from '../../../application/usecases/auth/revokeOtherSessions'
import { FakeAccountTokenRepository } from '../../../application/testing/fakeAccountTokenRepository'
import { FakeMailer } from '../../../application/testing/fakeMailer'
import { FakeSecretTokens } from '../../../application/testing/fakeSecretTokens'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import type { Mailer } from '../../../application/ports/mailer'
import { asUserId } from '../../../domain/shared/ids'
import type { Password } from '../../../domain/users/password'
import type { PasswordHash } from '../../../domain/users/user'

const HOST_ID = 'host-id'
const HOST_EMAIL = 'camille@example.test'
const FORMER_EMAIL = 'ancienne@example.test'
const OTHER_ID = 'other-id'
const OTHER_EMAIL = 'sacha@example.test'

/** The plaintext behind `builders.aUser`'s default hash. */
const PASSWORD = 'un-mot-de-passe-solide'
const NEW_PASSWORD = 'une-phrase-de-passe-2026'

/**
 * `buildHarness` mounts `express-session` under the library's default cookie name,
 * where the real server uses `es_session`. The fixation assertion below is about the id
 * changing rather than about the name, so it reads whichever name the app under test
 * emits — while the logout assertion names `SESSION_COOKIE` exactly, because clearing
 * the wrong name is the failure that test exists to catch.
 */
const HARNESS_SESSION_COOKIE = 'connect.sid'

/**
 * `hash:<plaintext>` — the shape `builders.aUser` already defaults to, so a fixture and
 * a login agree on one password without either restating it.
 *
 * Real bcrypt costs ~200 ms by design and there is no seam that makes it cheaper, which
 * is the whole reason `PasswordHasher` is a port. The fake still behaves: a wrong
 * password genuinely fails to verify, which is all these tests observe. Built here
 * rather than in `src/interface/http/testing/`, because the shared harness is mounted
 * by sibling route modules and a use-case bag is this module's own business.
 */
class FakePasswordHasher implements PasswordHasher {
  readonly dummyHash: PasswordHash = 'hash:*no-such-account*'

  async hash(password: Password): Promise<PasswordHash> {
    return `hash:${password.value}`
  }

  async verify(attempt: string, hash: PasswordHash): Promise<boolean> {
    return hash === `hash:${attempt}`
  }

  needsRehash(): boolean {
    // The opportunistic cost upgrade on sign-in is `authenticateUser`'s rule and has
    // its own ring-2 test. Exercising it here would add a branch no response reveals.
    return false
  }
}

const passThrough: RequestHandler = (_req, _res, next) => {
  next()
}

interface AuthHarness extends Harness {
  readonly users: FakeUserRepository
  /** What the box mailed, and the means to make it fail. */
  readonly mailer: FakeMailer
  readonly tokens: FakeAccountTokenRepository
  readonly secrets: FakeSecretTokens
}

interface AuthHarnessOptions {
  readonly config?: Partial<HttpConfig>
  /** Mounted in front of the router, for the failures the fakes cannot reach. */
  readonly before?: RequestHandler
  /**
   * Mounts the real CSRF middleware around the router, in the order `server.ts` uses.
   *
   * Off by default: every other test in this file is about what a login or a logout
   * *does*, and making each of them carry a token would say nothing about that. The
   * rotation tests need it because the token is the subject, and they need the gate
   * too — a rotated token that the gate then refuses would be a fix that breaks the
   * next request, which is the failure the second half of each of those tests names.
   */
  readonly csrf?: boolean
  /**
   * The mailer the box has. Defaults to a working relay (`FakeMailer`), because most of this
   * file is about what a reset *does*; `none` is a box that never set `SMTP_URL`, and a test
   * may bring its own to control when a send finishes.
   */
  readonly mail?: 'relay' | 'none' | Mailer
}

const harness = ({
  config = {},
  before = passThrough,
  csrf = false,
  mail = 'relay',
}: AuthHarnessOptions = {}): AuthHarness => {
  const users = new FakeUserRepository()
  const hasher = new FakePasswordHasher()
  const mailer = new FakeMailer()
  const tokens = new FakeAccountTokenRepository().withAccounts(
    asUserId(HOST_ID),
    asUserId(OTHER_ID),
  )
  const secrets = new FakeSecretTokens()
  const ids = new SequentialIdGenerator()
  const boxMailer: Mailer =
    mail === 'relay'
      ? mailer
      : mail === 'none'
        ? { canDeliver: false, send: mailer.send.bind(mailer) }
        : mail

  const built = buildHarness({
    config,
    users,
    mailer: boxMailer,
    routes: (app, deps) => {
      // One sign-in route, so a test can establish a session without driving a real
      // login. Outside `/api`, so it stays reachable when the gate below is mounted.
      // There used to be a second one that stamped `mustChangePassword` into the
      // session; P3-03 moved the source of that flag to storage, so a test that needs an
      // invited account seeds one into `subject.users` instead (`FakeUserRepository`).
      app.post('/test/sign-in', signInAs({ userId: HOST_ID, email: HOST_EMAIL }))
      app.post('/test/sign-in/other', signInAs({ userId: OTHER_ID, email: OTHER_EMAIL }))

      if (csrf) {
        app.use(issueCsrfToken({ secureCookie: deps.config.secureCookie }))
        app.use('/api', requireCsrfToken)
      }

      app.use(before)
      app.use(
        '/api',
        authRoutes({
          // `requireUser` reads the account on every `POST /api/auth/password`, so the
          // gate has to be asking the same repository the use cases were built from —
          // otherwise a test seeds a host into one world and is refused by another.
          deps: { ...deps, users },
          // The bag `authRoutes` asks for, built from fakes here: the HTTP layer is
          // never given a user repository, so a route test has to compose the two use
          // cases itself.
          usecases: {
            authenticateUser: makeAuthenticateUser({ users, hasher, clock: deps.clock }),
            changePassword: makeChangePassword({ users, hasher, clock: deps.clock }),
            revokeOtherSessions: makeRevokeOtherSessions({ users, clock: deps.clock }),
            requestPasswordReset: makeRequestPasswordReset({
              users,
              tokens,
              secrets,
              mailer: boxMailer,
              ids,
              clock: deps.clock,
              logger: deps.logger,
              publicUrl: deps.config.publicUrl,
            }),
            resetPassword: makeResetPassword({
              users,
              tokens,
              secrets,
              hasher,
              clock: deps.clock,
            }),
          },
        }),
      )
    },
  })

  return { ...built, users, mailer, tokens, secrets }
}

/** supertest types `headers` loosely, so the shape read here is narrowed explicitly. */
const setCookies = (headers: Record<string, unknown>): readonly string[] => {
  const raw = headers['set-cookie']
  if (typeof raw === 'string') return [raw]
  if (Array.isArray(raw)) return raw.map((entry) => String(entry))
  return []
}

const setCookie = (headers: Record<string, unknown>, name: string): string | undefined =>
  setCookies(headers).find((cookie) => cookie.startsWith(`${name}=`))

const cookieValue = (headers: Record<string, unknown>, name: string): string | undefined =>
  setCookie(headers, name)?.slice(`${name}=`.length).split(';')[0]

/** An agent holding a session, established without a real login. */
const signedIn = async (subject: AuthHarness, path = '/test/sign-in') => {
  const agent = request.agent(subject.app)
  await agent.post(path).expect(204)
  return agent
}

const seedHost = (subject: AuthHarness): void => {
  subject.users.seed(aUser({ id: HOST_ID, email: HOST_EMAIL, displayName: 'Camille' }))
}

describe('POST /api/auth/login', () => {
  it('answers with the signed-in identity and establishes a session', async () => {
    const subject = harness()
    seedHost(subject)

    const response = await request(subject.app)
      .post('/api/auth/login')
      .send({ email: HOST_EMAIL, password: PASSWORD })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      userId: HOST_ID,
      email: HOST_EMAIL,
      displayName: 'Camille',
      mustChangePassword: false,
    })
    expect(cookieValue(response.headers, HARNESS_SESSION_COOKIE)).toBeTruthy()
  })

  it('regenerates the session id, so a planted one does not survive the login', async () => {
    // The fixation defence. 1.0 never regenerated: an id planted through a subdomain,
    // a proxy or a link was still valid — and now privileged — after the victim signed
    // in. This is the single most important assertion in this file.
    const subject = harness()
    seedHost(subject)
    const agent = request.agent(subject.app)
    const planted = await agent.post('/test/sign-in').expect(204)
    const before = cookieValue(planted.headers, HARNESS_SESSION_COOKIE)

    const response = await agent
      .post('/api/auth/login')
      .send({ email: HOST_EMAIL, password: PASSWORD })

    expect(response.status).toBe(200)
    expect(before).toBeTruthy()
    expect(cookieValue(response.headers, HARNESS_SESSION_COOKIE)).toBeTruthy()
    expect(cookieValue(response.headers, HARNESS_SESSION_COOKIE)).not.toBe(before)
  })

  it('writes the identity into the session the response actually names', async () => {
    // The happy path proves a cookie came back and the fixation test proves the id
    // changed; neither would notice a payload written into a session that regeneration
    // then threw away. This asserts what a login is for: the session the browser now
    // holds carries the identity, on a later request.
    const subject = harness()
    seedHost(subject)
    const agent = request.agent(subject.app)

    await agent.post('/api/auth/login').send({ email: HOST_EMAIL, password: PASSWORD }).expect(200)

    const response = await agent.get('/api/auth/me')

    expect(response.body).toEqual({
      authenticated: true,
      user: {
        userId: HOST_ID,
        email: HOST_EMAIL,
        displayName: null,
        mustChangePassword: false,
        canOperateSite: false,
      },
    })
  })

  it('carries the forced-change flag of an invited account into the session', async () => {
    // Decided once, at the sign-in, and read on every later request. A flag that
    // reached the response body but not the session would let an invited moderator
    // walk past the one screen that exists to make them choose their own password.
    const subject = harness()
    subject.users.seed(
      aUser({ id: HOST_ID, email: HOST_EMAIL, displayName: 'Camille', mustChangePassword: true }),
    )
    const agent = request.agent(subject.app)

    const response = await agent
      .post('/api/auth/login')
      .send({ email: HOST_EMAIL, password: PASSWORD })

    expect(response.status).toBe(200)
    expect(response.body.mustChangePassword).toBe(true)
    const session = await agent.get('/api/auth/me')
    expect(session.body.user.mustChangePassword).toBe(true)
  })

  // Every row asserts the same body, which is the point: an unknown address, a wrong
  // password, a switched-off account and an unparseable address must be
  // indistinguishable, or the login form is an account-enumeration oracle.
  const refusals: readonly [string, object][] = [
    ['an unknown address', { email: 'inconnu@example.test', password: PASSWORD }],
    ['a wrong password', { email: HOST_EMAIL, password: 'un-autre-mot-de-passe' }],
    ['a disabled account', { email: FORMER_EMAIL, password: PASSWORD }],
    ['an address that is not an address', { email: 'pas-une-adresse', password: PASSWORD }],
  ]

  it.each(refusals)('answers exactly the same 401 for %s', async (_case, body) => {
    const subject = harness()
    seedHost(subject)
    subject.users.seed(aUser({ id: 'former-id', email: FORMER_EMAIL, disabledAt: AT }))

    const response = await request(subject.app).post('/api/auth/login').send(body)

    expect(response.status).toBe(401)
    expect(response.body).toEqual({
      error: {
        code: 'auth.invalidCredentials',
        message: expect.any(String),
        details: {},
      },
    })
  })

  it('leaves no session behind when the credentials are refused', async () => {
    // A row per guess would be a slow leak, and 1.0's MemoryStore never released one.
    const subject = harness()
    seedHost(subject)

    const response = await request(subject.app)
      .post('/api/auth/login')
      .send({ email: HOST_EMAIL, password: 'un-autre-mot-de-passe' })

    expect(response.status).toBe(401)
    expect(setCookies(response.headers)).toEqual([])
  })

  const malformed: readonly [string, object][] = [
    ['an empty body', {}],
    ['no password', { email: HOST_EMAIL }],
    ['no email', { password: PASSWORD }],
    ['an empty password', { email: HOST_EMAIL, password: '' }],
    ['an email that is not a string', { email: 42, password: PASSWORD }],
    ['an unexpected field', { email: HOST_EMAIL, password: PASSWORD, remember: true }],
  ]

  it.each(malformed)('answers 400 for %s', async (_case, body) => {
    const subject = harness()
    seedHost(subject)

    const response = await request(subject.app).post('/api/auth/login').send(body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('answers 429 once the per-minute login limit is spent', async () => {
    const subject = harness({
      config: { rateLimits: { ...testHttpConfig().rateLimits, loginPerMinute: 1 } },
    })
    seedHost(subject)
    const guess = { email: HOST_EMAIL, password: 'un-autre-mot-de-passe' }

    const first = await request(subject.app).post('/api/auth/login').send(guess)
    const second = await request(subject.app).post('/api/auth/login').send(guess)

    expect(first.status).toBe(401)
    expect(second.status).toBe(429)
    expect(second.body.error.code).toBe('rate.limited')
  })

  // A regeneration that failed quietly would leave the fixation defence off and answer
  // 200 to hide it, so the failure has to be surfaced. The store going away mid-login
  // is not reachable through the fakes; this replaces `regenerate` at the seam
  // `express-session` itself exposes.
  const regenerationFailures: readonly [string, unknown][] = [
    ['an Error', new Error('session store unavailable')],
    ['a bare value, as callback APIs do produce', 'session store unavailable'],
  ]

  it.each(regenerationFailures)(
    'refuses the login when session regeneration fails with %s',
    async (_case, cause) => {
      const subject = harness({
        before: (req, _res, next) => {
          req.session.regenerate = (done) => {
            done(cause)
            return req.session
          }
          next()
        },
      })
      seedHost(subject)

      const response = await request(subject.app)
        .post('/api/auth/login')
        .send({ email: HOST_EMAIL, password: PASSWORD })

      expect(response.status).toBe(500)
      expect(response.body.error.code).toBe('server.unexpected')
      expect(setCookies(response.headers)).toEqual([])
    },
  )
})

describe('POST /api/auth/logout', () => {
  it('destroys the session', async () => {
    const subject = harness()
    const agent = await signedIn(subject)

    const response = await agent.post('/api/auth/logout')

    expect(response.status).toBe(204)
    const after = await agent.get('/api/auth/me')
    expect(after.body).toEqual({ authenticated: false })
  })

  it('clears the session cookie by name, path and expiry', async () => {
    // `destroy` removes the stored row but tells the browser nothing, and a browser
    // matches a deletion on name and path only.
    const subject = harness()
    const agent = await signedIn(subject)

    const response = await agent.post('/api/auth/logout')

    const cleared = setCookie(response.headers, SESSION_COOKIE)
    expect(cleared).toBeDefined()
    expect(cookieValue(response.headers, SESSION_COOKIE)).toBe('')
    expect(cleared).toContain('Path=/')
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970')
    expect(cleared).toContain('HttpOnly')
  })

  it('answers 204 with no session at all', async () => {
    const response = await request(harness().app).post('/api/auth/logout')

    expect(response.status).toBe(204)
  })

  it.each([1, 2])('answers 204 again after %i previous logouts', async (previous) => {
    const subject = harness()
    const agent = await signedIn(subject)
    for (let attempt = 0; attempt < previous; attempt += 1) {
      await agent.post('/api/auth/logout')
    }

    const response = await agent.post('/api/auth/logout')

    expect(response.status).toBe(204)
  })

  it('surfaces a session store that cannot destroy the session', async () => {
    // 204 here would say the session is gone when it is still valid.
    const subject = harness({
      before: (req, _res, next) => {
        req.session.destroy = (done) => {
          done(new Error('session store unavailable'))
          return req.session
        }
        next()
      },
    })
    const agent = await signedIn(subject)

    const response = await agent.post('/api/auth/logout')

    expect(response.status).toBe(500)
    expect(response.body.error.code).toBe('server.unexpected')
  })
})

describe('GET /api/auth/me', () => {
  it('answers 200 and authenticated: false without a session', async () => {
    // Not 401: the client asks this on every page load, and a 401 in the console on a
    // first visit is noise (docs/API.md §5).
    const response = await request(harness().app).get('/api/auth/me')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ authenticated: false })
  })

  it('creates no session for an anonymous caller', async () => {
    const response = await request(harness().app).get('/api/auth/me')

    expect(setCookies(response.headers)).toEqual([])
  })

  it('forbids any cache from storing the answer', async () => {
    // The identity itself, on the one read the client makes on every page load. With
    // `rolling: true` an authenticated answer also carries a fresh `Set-Cookie`, so a
    // shared cache — a venue proxy, or whatever a self-hosted box sits behind — holding
    // this response would hand one host's session to the next visitor.
    const subject = harness()
    const agent = await signedIn(subject)

    const response = await agent.get('/api/auth/me')

    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('answers with the session principal when there is a session', async () => {
    // `displayName` is null by design: the session carries the identity and nothing
    // that goes stale, and the account read below is deliberately one column — the
    // login response is what carries the fresh name.
    const subject = harness()
    seedHost(subject)
    const agent = await signedIn(subject)

    const response = await agent.get('/api/auth/me')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      authenticated: true,
      user: {
        userId: HOST_ID,
        email: HOST_EMAIL,
        displayName: null,
        mustChangePassword: false,
        canOperateSite: false,
      },
    })
  })

  describe('canOperateSite', () => {
    // The account menu will offer the operator's console on this flag together with
    // `features.siteAdmin` (RC3.4), so it is the one place a plain host could be handed a
    // link to a surface that refuses them.
    // It reports the account's authority over the box, read from storage on this request,
    // and it grants nothing: `requireOperator` is what gates `/api/site`, and asks the
    // same question (`canOperateSite(siteRole)`) of the same column.

    const canOperateSite = async (subject: AuthHarness): Promise<unknown> => {
      const agent = await signedIn(subject)
      const response = await agent.get('/api/auth/me')
      return response.body.user?.canOperateSite
    }

    it('is true for an operator', async () => {
      const subject = harness()
      subject.users.seed(aUser({ id: HOST_ID, email: HOST_EMAIL, siteRole: 'operator' }))

      expect(await canOperateSite(subject)).toBe(true)
    })

    it('is false for an ordinary account, an owner of events included', async () => {
      const subject = harness()
      subject.users.seed(aUser({ id: HOST_ID, email: HOST_EMAIL, siteRole: 'none' }))

      expect(await canOperateSite(subject)).toBe(false)
    })

    it('is not moved by anything else about the account, such as a password it must still change', async () => {
      const ordinary = harness()
      ordinary.users.seed(
        aUser({ id: HOST_ID, email: HOST_EMAIL, siteRole: 'none', mustChangePassword: true }),
      )
      const operator = harness()
      operator.users.seed(
        aUser({ id: HOST_ID, email: HOST_EMAIL, siteRole: 'operator', mustChangePassword: true }),
      )

      expect(await canOperateSite(ordinary)).toBe(false)
      expect(await canOperateSite(operator)).toBe(true)
    })

    it('is read from storage on this request, not from the session that was opened before', async () => {
      // Demoted at 19:00, still holding the tab opened at 18:00: the next `/me` says so.
      const subject = harness()
      subject.users.seed(aUser({ id: HOST_ID, email: HOST_EMAIL, siteRole: 'operator' }))
      const agent = await signedIn(subject)
      expect((await agent.get('/api/auth/me')).body.user.canOperateSite).toBe(true)

      await subject.users.save(aUser({ id: HOST_ID, email: HOST_EMAIL, siteRole: 'none' }))

      expect((await agent.get('/api/auth/me')).body.user.canOperateSite).toBe(false)
    })

    it('says nothing about a disabled operator, who is not signed in as far as anyone can tell', async () => {
      const subject = harness()
      subject.users.seed(
        aUser({ id: HOST_ID, email: HOST_EMAIL, siteRole: 'operator', disabledAt: AT }),
      )
      const agent = await signedIn(subject)

      expect((await agent.get('/api/auth/me')).body).toEqual({ authenticated: false })
    })

    it.each([true, false])(
      'does not depend on SITE_ADMIN, which decides how much surface exists and not who is whom (siteAdmin: %s)',
      async (siteAdmin) => {
        // The SPA shows the console entry when this AND `features.siteAdmin` (GET
        // /api/about) are both true. Folding the switch in here would make this field a
        // second place that knows what the mode is.
        const subject = harness({ config: { siteAdmin } })
        subject.users.seed(aUser({ id: HOST_ID, email: HOST_EMAIL, siteRole: 'operator' }))

        expect(await canOperateSite(subject)).toBe(true)
      },
    )

    it('asks for the role of an account that may act, and of nobody else', async () => {
      // An anonymous page load is the commonest request this API gets, and a disabled
      // account is told it is not signed in: neither has any use for a site role, and a
      // read made for them is a read that could one day answer.
      const asked: string[] = []
      const watched = (subject: AuthHarness): AuthHarness => {
        const original = subject.users.siteRoleFor.bind(subject.users)
        subject.users.siteRoleFor = async (id) => {
          asked.push(id)
          return original(id)
        }
        return subject
      }

      await request(watched(harness()).app).get('/api/auth/me')
      const disabled = watched(harness())
      disabled.users.seed(
        aUser({ id: HOST_ID, email: HOST_EMAIL, siteRole: 'operator', disabledAt: AT }),
      )
      await (await signedIn(disabled)).get('/api/auth/me')
      expect(asked).toEqual([])

      const active = watched(harness())
      active.users.seed(aUser({ id: HOST_ID, email: HOST_EMAIL }))
      await (await signedIn(active)).get('/api/auth/me')
      expect(asked).toEqual([HOST_ID])
    })

    it('is not part of the login response, which stays the identity and nothing else', async () => {
      const subject = harness()
      subject.users.seed(aUser({ id: HOST_ID, email: HOST_EMAIL, siteRole: 'operator' }))

      const response = await request(subject.app)
        .post('/api/auth/login')
        .send({ email: HOST_EMAIL, password: PASSWORD })

      expect(Object.keys(response.body).sort()).toEqual([
        'displayName',
        'email',
        'mustChangePassword',
        'userId',
      ])
    })
  })

  /**
   * This is the answer the admin shell routes on, so it is the one that decides whether
   * a disabled host meets a login form or a console where every request then fails. The
   * session still exists — the absolute cap has not run out — and it still names nobody
   * who may act.
   */
  it('reports a disabled account as not authenticated, whatever the session still says', async () => {
    const subject = harness()
    subject.users.seed(aUser({ id: HOST_ID, email: HOST_EMAIL, disabledAt: AT }))
    const agent = await signedIn(subject)

    const response = await agent.get('/api/auth/me')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ authenticated: false })
  })

  it('reports an account that is gone as not authenticated, which is the same question', async () => {
    const subject = harness()
    const agent = await signedIn(subject)

    expect((await agent.get('/api/auth/me')).body).toEqual({ authenticated: false })
  })
})

describe('POST /api/auth/password', () => {
  const change = { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }

  it('clears the forced-change flag in storage on success, which the next request reads', async () => {
    // Otherwise the invited moderator's "choose a password" gate stays shut until a
    // reload, on the one screen they cannot get past. Nothing about the session carries
    // the flag any more (P3-03): the account is seeded into storage already flagged, and
    // what proves the clear worked is the next request re-reading it from there.
    const subject = harness()
    subject.users.seed(
      aUser({ id: HOST_ID, email: HOST_EMAIL, displayName: 'Camille', mustChangePassword: true }),
    )
    const agent = await signedIn(subject)

    const response = await agent.post('/api/auth/password').send(change)

    expect(response.status).toBe(204)
    const after = await agent.get('/api/auth/me')
    expect(after.body).toEqual({
      authenticated: true,
      user: {
        userId: HOST_ID,
        email: HOST_EMAIL,
        displayName: null,
        mustChangePassword: false,
        canOperateSite: false,
      },
    })
  })

  it('changes the password of the session account, so the new one signs in', async () => {
    const subject = harness()
    seedHost(subject)
    const agent = await signedIn(subject)
    await agent.post('/api/auth/password').send(change).expect(204)

    const response = await request(subject.app)
      .post('/api/auth/login')
      .send({ email: HOST_EMAIL, password: NEW_PASSWORD })

    expect(response.status).toBe(200)
    expect(response.body.userId).toBe(HOST_ID)
  })

  it('answers 401 when the principal is gone by the time the handler runs', async () => {
    // Unreachable through `requireUser`, which is exactly the point: the guard is what
    // keeps a later middleware that clears the principal from turning this into a
    // password change for nobody, and `strict` forbids the non-null assertion that
    // would hide the question. Driven by a principal the request yields only once.
    const subject = harness({
      before: (req, _res, next) => {
        const reads = [req.context.user]
        Object.defineProperty(req.context, 'user', { get: () => reads.shift() })
        next()
      },
    })
    seedHost(subject)
    const agent = await signedIn(subject)

    const response = await agent.post('/api/auth/password').send(change)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('answers 401 without a session', async () => {
    const subject = harness()
    seedHost(subject)

    const response = await request(subject.app).post('/api/auth/password').send(change)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('answers 401 to a guest token, which is no principal here', async () => {
    // The closest thing to a wrong-role case on a route with no event in its path: a
    // guest device token grants upload to one event and nothing else, least of all a
    // password change.
    const subject = harness()
    seedHost(subject)
    const token = subject.issueGuestToken('wedding-id', 'guest-1')

    const response = await request(subject.app)
      .post('/api/auth/password')
      .set('Cookie', `${GUEST_COOKIE}=${token}`)
      .send(change)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('answers 401 for a wrong current password', async () => {
    const subject = harness()
    seedHost(subject)
    const agent = await signedIn(subject)

    const response = await agent
      .post('/api/auth/password')
      .send({ currentPassword: 'un-autre-mot-de-passe', newPassword: NEW_PASSWORD })

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.invalidCredentials')
  })

  const rejected: readonly [string, string, string][] = [
    ['shorter than the minimum', 'court', 'password.tooShort'],
    ['on the blocklist', 'password1234', 'password.tooCommon'],
    ['the account email', HOST_EMAIL, 'password.sameAsEmail'],
    ['the password already on file', PASSWORD, 'password.unchanged'],
  ]

  it.each(rejected)(
    'answers 400 with the domain code for a password %s',
    async (_case, newPassword, code) => {
      const subject = harness()
      seedHost(subject)
      const agent = await signedIn(subject)

      const response = await agent
        .post('/api/auth/password')
        .send({ currentPassword: PASSWORD, newPassword })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe(code)
    },
  )

  const malformed: readonly [string, object][] = [
    ['an empty body', {}],
    ['no new password', { currentPassword: PASSWORD }],
    ['no current password', { newPassword: NEW_PASSWORD }],
    ['an empty current password', { currentPassword: '', newPassword: NEW_PASSWORD }],
  ]

  it.each(malformed)('answers 400 for %s', async (_case, body) => {
    const subject = harness()
    seedHost(subject)
    const agent = await signedIn(subject)

    const response = await agent.post('/api/auth/password').send(body)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('refuses a body naming another account, so the session is the only identity', async () => {
    // The account whose password changes is read from the session. A `userId` a client
    // could send would make this endpoint a password reset for every account on the box.
    const subject = harness()
    seedHost(subject)
    subject.users.seed(aUser({ id: 'former-id', email: FORMER_EMAIL }))
    const agent = await signedIn(subject)

    const response = await agent.post('/api/auth/password').send({ ...change, userId: 'former-id' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('request.invalid')
  })

  it('answers 401 when the session names an account that no longer exists', async () => {
    // A session outliving its user, refused by `requireUser` before the handler runs.
    // It used to reach `changePassword` and come back `404 user.notFound`, which told a
    // browser holding a dead session that the route was missing rather than that it was
    // no longer anybody. The use case keeps that branch — it is reachable from anything
    // else that calls it — and this route can no longer produce it.
    const subject = harness()
    const agent = await signedIn(subject)

    const response = await agent.post('/api/auth/password').send(change)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('lets a host sign in again on the very request that trips the absolute cap', async () => {
    // The 500 this exists to refuse: `enforceSessionAge` used to `destroy` the session,
    // which deletes `req.session` before the store call, and `regenerateSession` on the
    // login dereferences it — so the password was bcrypt-verified and the response was a
    // TypeError. The second attempt then worked, because the stale sid no longer
    // resolved, which is the worst possible shape for a host at a venue.
    const subject = harness()
    seedHost(subject)
    const agent = await signedIn(subject)
    subject.clock.advance(ABSOLUTE_SESSION_LIFETIME_MS)

    const response = await agent
      .post('/api/auth/login')
      .send({ email: HOST_EMAIL, password: PASSWORD })

    expect(response.status).toBe(200)
  })

  it('lets a host log out on the request that trips the absolute cap', async () => {
    // The logout is public precisely so that a client whose session has already expired
    // can still clear it. Answering 500 there left the cookie in the browser and skipped
    // the CSRF rotation.
    const subject = harness()
    seedHost(subject)
    const agent = await signedIn(subject)
    subject.clock.advance(ABSOLUTE_SESSION_LIFETIME_MS)

    const response = await agent.post('/api/auth/logout')

    expect(response.status).toBe(204)
  })

  it('answers 401 a week after the login that established the session', async () => {
    // The login is the only place `issuedAt` is written, so this is where "the absolute
    // cap is armed at all" is asserted: without the stamp, `enforceSessionAge` would be
    // a middleware reading a field nothing sets.
    const subject = harness()
    seedHost(subject)
    const agent = request.agent(subject.app)
    await agent.post('/api/auth/login').send({ email: HOST_EMAIL, password: PASSWORD }).expect(200)

    subject.clock.advance(ABSOLUTE_SESSION_LIFETIME_MS)

    const response = await agent.post('/api/auth/password').send(change)
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })

  it('answers 401 when the account behind the session has been disabled', async () => {
    // The defect this closes: `disabled_at` was read on one line in the whole product,
    // inside `authenticateUser`, so switching a host off stopped the next sign-in and
    // stopped nothing they were already doing. This route is not event-scoped, so no
    // role lookup would ever have noticed.
    const subject = harness()
    subject.users.seed(
      aUser({ id: HOST_ID, email: HOST_EMAIL, displayName: 'Camille', disabledAt: AT }),
    )
    const agent = await signedIn(subject)

    const response = await agent.post('/api/auth/password').send(change)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })
})

/**
 * F9: the CSRF token used to outlive the identity it protected.
 *
 * `issueCsrfToken` writes the cookie only when it is absent, so one `es_csrf` covered
 * the anonymous visitor, the guest and the signed-in host alike — it survived the login
 * that created the session and the logout that destroyed it. The token is rotated in
 * the same gesture as `session.regenerate()` and `session.destroy()` now, and each test
 * below asserts both halves: the value changed, and the very next state-changing
 * request still goes through. A rotation that locked the client out would be worse than
 * no rotation, because it would fail on the screen the host just reached.
 */
/**
 * "Sign out everywhere" and the password change both work through the credentials epoch
 * (G2-08 / P3-09): the account says when its credentials last changed and every session
 * issued before that instant is refused. Two agents stand for two devices, and what they
 * observe is the contract — the answer of `GET /api/auth/me`, which is what the admin
 * shell routes on.
 */
describe('the account’s other sessions', () => {
  /** Two devices of one host, signed in a minute apart from the moment anything changes. */
  const twoDevices = async (subject: AuthHarness) => {
    const phone = await signedIn(subject)
    const laptop = await signedIn(subject)
    subject.clock.advance(60_000)
    return { phone, laptop }
  }

  const isSignedIn = async (agent: ReturnType<typeof request.agent>): Promise<boolean> =>
    (await agent.get('/api/auth/me')).body.authenticated === true

  describe('after POST /api/auth/password', () => {
    const change = { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }

    it('signs the account out of every other device', async () => {
      const subject = harness()
      seedHost(subject)
      const { phone, laptop } = await twoDevices(subject)

      await laptop.post('/api/auth/password').send(change).expect(204)

      expect(await isSignedIn(phone)).toBe(false)
    })

    it('keeps the device that chose the password signed in', async () => {
      const subject = harness()
      seedHost(subject)
      const { laptop } = await twoDevices(subject)

      await laptop.post('/api/auth/password').send(change).expect(204)

      expect(await isSignedIn(laptop)).toBe(true)
    })

    it('gives that device a new session id, so a cookie copied before the change is a different one', async () => {
      const subject = harness()
      seedHost(subject)
      const { laptop } = await twoDevices(subject)
      const before = cookieValue((await laptop.get('/api/auth/me')).headers, HARNESS_SESSION_COOKIE)

      const response = await laptop.post('/api/auth/password').send(change).expect(204)

      const after = cookieValue(response.headers, HARNESS_SESSION_COOKIE)
      expect(after).toBeTruthy()
      expect(after).not.toBe(before)
    })

    it('leaves every other device signed in when the change is refused', async () => {
      const subject = harness()
      seedHost(subject)
      const { phone, laptop } = await twoDevices(subject)

      await laptop
        .post('/api/auth/password')
        .send({ currentPassword: 'pas-le-bon', newPassword: NEW_PASSWORD })
        .expect(401)

      expect(await isSignedIn(phone)).toBe(true)
    })

    it('does not sign anybody else out', async () => {
      const subject = harness()
      seedHost(subject)
      subject.users.seed(aUser({ id: OTHER_ID, email: OTHER_EMAIL }))
      const other = request.agent(subject.app)
      await other.post('/test/sign-in/other').expect(204)
      const { laptop } = await twoDevices(subject)

      await laptop.post('/api/auth/password').send(change).expect(204)

      expect(await isSignedIn(other)).toBe(true)
    })

    it('replaces the CSRF token with the session, so the device keeps writing under the new pair', async () => {
      const subject = harness({ csrf: true })
      seedHost(subject)
      const agent = request.agent(subject.app)
      const token = cookieValue((await agent.get('/api/auth/me')).headers, CSRF_COOKIE)
      if (token === undefined) throw new Error('the server issued no CSRF cookie')
      await agent.post('/test/sign-in').expect(204)

      const changed = await agent
        .post('/api/auth/password')
        .set(CSRF_HEADER, token)
        .send(change)
        .expect(204)

      const rotated = cookieValue(changed.headers, CSRF_COOKIE)
      expect(rotated).toBeTruthy()
      expect(rotated).not.toBe(token)
      await agent
        .post('/api/auth/sessions/revoke-others')
        .set(CSRF_HEADER, rotated ?? '')
        .expect(204)
    })
  })

  describe('the seven-day cap', () => {
    const DAY = 24 * 60 * 60 * 1000

    it('is not restarted by pressing "sign out everywhere", however often', async () => {
      // The person signed in once. A stolen cookie that presses the button every six days
      // must still end a week after that sign-in; if a renewal made the session younger, the
      // week would become "until the victim notices".
      const subject = harness()
      seedHost(subject)
      const thief = await signedIn(subject)

      subject.clock.advance(3 * DAY)
      await thief.post('/api/auth/sessions/revoke-others').expect(204)
      subject.clock.advance(3 * DAY)
      await thief.post('/api/auth/sessions/revoke-others').expect(204)
      expect(await isSignedIn(thief)).toBe(true)

      subject.clock.advance(2 * DAY)

      expect(await isSignedIn(thief)).toBe(false)
    })

    it('is not restarted by a password change either', async () => {
      const subject = harness()
      seedHost(subject)
      const laptop = await signedIn(subject)
      subject.clock.advance(6 * DAY)
      await laptop
        .post('/api/auth/password')
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(204)
      expect(await isSignedIn(laptop)).toBe(true)

      subject.clock.advance(2 * DAY)

      expect(await isSignedIn(laptop)).toBe(false)
    })

    it('still counts from the sign-in after a login, which is what starts it', async () => {
      const subject = harness()
      seedHost(subject)
      subject.clock.advance(6 * DAY)
      const agent = request.agent(subject.app)
      await agent
        .post('/api/auth/login')
        .send({ email: HOST_EMAIL, password: PASSWORD })
        .expect(200)

      subject.clock.advance(6 * DAY)

      expect(await isSignedIn(agent)).toBe(true)
    })
  })

  describe('POST /api/auth/sessions/revoke-others', () => {
    it('answers 204 and signs the account out of every other device', async () => {
      const subject = harness()
      seedHost(subject)
      const { phone, laptop } = await twoDevices(subject)

      const response = await laptop.post('/api/auth/sessions/revoke-others')

      expect(response.status).toBe(204)
      expect(await isSignedIn(phone)).toBe(false)
    })

    it('keeps the device that asked signed in, with a session of its own', async () => {
      const subject = harness()
      seedHost(subject)
      const { laptop } = await twoDevices(subject)
      const before = cookieValue((await laptop.get('/api/auth/me')).headers, HARNESS_SESSION_COOKIE)

      const response = await laptop.post('/api/auth/sessions/revoke-others').expect(204)

      expect(await isSignedIn(laptop)).toBe(true)
      const after = cookieValue(response.headers, HARNESS_SESSION_COOKIE)
      expect(after).toBeTruthy()
      expect(after).not.toBe(before)
    })

    it('does not touch the password', async () => {
      const subject = harness()
      seedHost(subject)
      const { laptop } = await twoDevices(subject)
      await laptop.post('/api/auth/sessions/revoke-others').expect(204)

      const response = await request(subject.app)
        .post('/api/auth/login')
        .send({ email: HOST_EMAIL, password: PASSWORD })

      expect(response.status).toBe(200)
    })

    it('signs out the caller’s own account and nobody else’s', async () => {
      const subject = harness()
      seedHost(subject)
      subject.users.seed(aUser({ id: OTHER_ID, email: OTHER_EMAIL }))
      const other = request.agent(subject.app)
      await other.post('/test/sign-in/other').expect(204)
      const { laptop } = await twoDevices(subject)

      await laptop.post('/api/auth/sessions/revoke-others').expect(204)

      expect(await isSignedIn(other)).toBe(true)
    })

    it('lets the device sign in again on the other side of it, the way a person who got back to their desk would', async () => {
      const subject = harness()
      seedHost(subject)
      const { phone, laptop } = await twoDevices(subject)
      await laptop.post('/api/auth/sessions/revoke-others').expect(204)
      subject.clock.advance(1_000)

      await phone
        .post('/api/auth/login')
        .send({ email: HOST_EMAIL, password: PASSWORD })
        .expect(200)

      expect(await isSignedIn(phone)).toBe(true)
    })

    it('answers 401 without a session', async () => {
      const subject = harness()

      const response = await request(subject.app).post('/api/auth/sessions/revoke-others')

      expect(response.status).toBe(401)
      expect(response.body.error.code).toBe('auth.required')
    })

    it('answers 401 to an account that has been switched off', async () => {
      const subject = harness()
      subject.users.seed(aUser({ id: HOST_ID, email: HOST_EMAIL, disabledAt: AT }))
      const agent = await signedIn(subject)

      const response = await agent.post('/api/auth/sessions/revoke-others')

      expect(response.status).toBe(401)
    })

    it('refuses a state-changing call without the CSRF token like every other write', async () => {
      const subject = harness({ csrf: true })
      seedHost(subject)
      const agent = await signedIn(subject)

      const response = await agent.post('/api/auth/sessions/revoke-others')

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('request.csrfMissing')
    })
  })
})

/**
 * The two unauthenticated halves of a password reset: asking for a link, and spending one.
 * What these hold is that the *answer* reveals nothing — the same status, body and headers
 * for an address that is an account and for one that is not — and that a link works once,
 * ends every session, and never signs anybody in.
 */
describe('password reset', () => {
  const NEW = 'une-phrase-de-passe-neuve'
  const TOKEN = /\/password\/reset\/([A-Za-z0-9_-]+)/

  const ask = (subject: AuthHarness, email: string, extra: Record<string, unknown> = {}) =>
    request(subject.app)
      .post('/api/auth/password-reset/request')
      .send({ email, ...extra })

  const confirm = (subject: AuthHarness, token: string, password = NEW) =>
    request(subject.app).post('/api/auth/password-reset/confirm').send({ token, password })

  /** Waits for the work behind a 202, which the response itself deliberately does not. */
  const mailed = async (subject: AuthHarness, count = 1) => {
    await vi.waitFor(() => expect(subject.mailer.sent).toHaveLength(count))
    return subject.mailer.sent
  }

  /** The token the last mail carried, read the way a person would: out of the link. */
  const tokenInLastMail = (subject: AuthHarness): string => {
    const mail = subject.mailer.sent.at(-1)
    const token = mail === undefined ? undefined : TOKEN.exec(mail.text)?.[1]
    if (token === undefined) throw new Error('no reset link in the last mail')
    return token
  }

  describe('POST /api/auth/password-reset/request', () => {
    it('answers 202 with an empty body and mails the account a link', async () => {
      const subject = harness()
      seedHost(subject)

      const response = await ask(subject, HOST_EMAIL)

      expect(response.status).toBe(202)
      expect(response.body).toEqual({})
      const [mail] = await mailed(subject)
      expect(mail?.to).toBe(HOST_EMAIL)
      expect(mail?.text).toMatch(TOKEN)
    })

    it('answers exactly the same for an address that is not an account', async () => {
      const subject = harness()
      seedHost(subject)

      const known = await ask(subject, HOST_EMAIL)
      const unknown = await ask(subject, 'personne@example.test')

      expect(unknown.status).toBe(known.status)
      expect(unknown.body).toEqual(known.body)
      expect(unknown.headers['cache-control']).toBe(known.headers['cache-control'])
      expect(unknown.headers['content-type']).toBe(known.headers['content-type'])
      expect(unknown.headers['content-length']).toBe(known.headers['content-length'])
      await mailed(subject)
      expect(subject.mailer.sent).toHaveLength(1)
    })

    it('answers the same for a malformed address, a disabled account and one over its cap', async () => {
      const subject = harness()
      subject.users.seed(aUser({ id: HOST_ID, email: HOST_EMAIL }))
      subject.users.seed(aUser({ id: OTHER_ID, email: OTHER_EMAIL, disabledAt: AT }))
      const reference = await ask(subject, HOST_EMAIL)

      const answers = await Promise.all([
        ask(subject, 'pas une adresse'),
        ask(subject, OTHER_EMAIL),
        ask(subject, HOST_EMAIL),
        ask(subject, HOST_EMAIL),
        ask(subject, HOST_EMAIL),
      ])

      for (const answer of answers) {
        expect(answer.status).toBe(reference.status)
        expect(answer.body).toEqual(reference.body)
      }
    })

    it('does not wait for the mail: it answers while the relay is still thinking', async () => {
      // How long a relay takes to say yes is a way to tell an address that exists from one
      // that does not. A send that never finishes must not hold the response.
      let release: () => void = () => undefined
      const slow: Mailer = {
        canDeliver: true,
        send: () =>
          new Promise((resolve) => (release = () => resolve({ ok: true, value: undefined }))),
      }
      const subject = harness({ mail: slow })
      seedHost(subject)

      const response = await ask(subject, HOST_EMAIL)

      expect(response.status).toBe(202)
      release()
    })

    it('mails an address at most three times an hour, and says nothing different the fourth time', async () => {
      const subject = harness({
        config: { rateLimits: { ...testHttpConfig().rateLimits, loginPerMinute: 50 } },
      })
      seedHost(subject)

      const statuses: number[] = []
      for (let attempt = 0; attempt < 5; attempt += 1) {
        statuses.push((await ask(subject, HOST_EMAIL)).status)
        subject.clock.advance(1_000)
      }

      expect(statuses).toEqual([202, 202, 202, 202, 202])
      await mailed(subject, 3)
      await new Promise((resolve) => setImmediate(resolve))
      expect(subject.mailer.sent).toHaveLength(3)
    })

    it('writes the mail in the language of the page that asked', async () => {
      const subject = harness()
      seedHost(subject)

      await ask(subject, HOST_EMAIL, { locale: 'it' })

      expect((await mailed(subject))[0]?.text).toContain('Buongiorno')
    })

    it('answers 404 feature.unavailable on a box with no mail relay, whatever the address', async () => {
      const subject = harness({ mail: 'none' })
      seedHost(subject)

      for (const email of [HOST_EMAIL, 'personne@example.test']) {
        const response = await ask(subject, email)

        expect(response.status).toBe(404)
        expect(response.body.error.code).toBe('feature.unavailable')
      }
    })

    it('never shows the link to the person who asked, relay or not', async () => {
      for (const mail of ['relay', 'none'] as const) {
        const subject = harness({ mail })
        seedHost(subject)

        const response = await ask(subject, HOST_EMAIL)

        expect(JSON.stringify(response.body)).not.toMatch(/password\/reset|secret-\d/)
        expect(JSON.stringify(response.headers)).not.toMatch(/password\/reset|secret-\d/)
      }
    })

    it('issues no link at all on a box with no relay', async () => {
      const subject = harness({ mail: 'none' })
      seedHost(subject)

      await ask(subject, HOST_EMAIL)
      await new Promise((resolve) => setImmediate(resolve))

      expect(subject.tokens.all).toEqual([])
      expect(subject.mailer.sent).toEqual([])
    })

    it('forbids any cache from storing the answer', async () => {
      const subject = harness()

      expect((await ask(subject, HOST_EMAIL)).headers['cache-control']).toBe('no-store')
    })

    it.each([
      ['no body', {}],
      ['an empty address', { email: '' }],
      ['an address a kilobyte long', { email: 'a'.repeat(1_000) }],
      ['an unknown key', { email: HOST_EMAIL, userId: HOST_ID }],
      ['a language the product does not speak', { email: HOST_EMAIL, locale: 'pt' }],
      ['an address that is not a string', { email: ['a@b.example'] }],
    ])('answers 400 request.invalid for %s', async (_label, body) => {
      const subject = harness()

      const response = await request(subject.app)
        .post('/api/auth/password-reset/request')
        .send(body)

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('request.invalid')
    })

    it('answers 429 once the per-minute limit is spent, whoever the address is', async () => {
      const subject = harness({
        config: { rateLimits: { ...testHttpConfig().rateLimits, loginPerMinute: 2 } },
      })

      await ask(subject, 'un@example.test')
      await ask(subject, 'deux@example.test')
      const third = await ask(subject, 'trois@example.test')

      expect(third.status).toBe(429)
      expect(third.body.error.code).toBe('rate.limited')
    })

    it('refuses a state-changing call without the CSRF token like every other write', async () => {
      const subject = harness({ csrf: true })

      const response = await ask(subject, HOST_EMAIL)

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('request.csrfMissing')
    })
  })

  describe('POST /api/auth/password-reset/confirm', () => {
    const askAndRead = async (subject: AuthHarness): Promise<string> => {
      await ask(subject, HOST_EMAIL).expect(202)
      await mailed(subject)
      return tokenInLastMail(subject)
    }

    it('answers 204 and the new password signs in, the old one no longer does', async () => {
      const subject = harness()
      seedHost(subject)
      const token = await askAndRead(subject)

      await confirm(subject, token).expect(204)

      const fresh = await request(subject.app)
        .post('/api/auth/login')
        .send({ email: HOST_EMAIL, password: NEW })
      const old = await request(subject.app)
        .post('/api/auth/login')
        .send({ email: HOST_EMAIL, password: PASSWORD })
      expect(fresh.status).toBe(200)
      expect(old.status).toBe(401)
    })

    it('signs the account out of every device it was signed in on', async () => {
      const subject = harness()
      seedHost(subject)
      const phone = await signedIn(subject)
      const token = await askAndRead(subject)
      subject.clock.advance(60_000)

      await confirm(subject, token).expect(204)

      const me = await phone.get('/api/auth/me')
      expect(me.body.authenticated).toBe(false)
    })

    it('starts no session: a reset proves a mailbox, not a sign-in', async () => {
      const subject = harness()
      seedHost(subject)
      const token = await askAndRead(subject)

      const response = await confirm(subject, token)

      expect(
        setCookies(response.headers).filter((c) => c.startsWith(HARNESS_SESSION_COOKIE)),
      ).toEqual([])
    })

    it('refuses the same link the second time, with 400 auth.invalidToken', async () => {
      const subject = harness()
      seedHost(subject)
      const token = await askAndRead(subject)
      await confirm(subject, token).expect(204)

      const again = await confirm(subject, token, 'une-autre-phrase-de-passe')

      expect(again.status).toBe(400)
      expect(again.body.error.code).toBe('auth.invalidToken')
    })

    it('refuses a link after the hour, and a link replaced by a newer one', async () => {
      const subject = harness()
      seedHost(subject)
      const old = await askAndRead(subject)
      subject.clock.advance(1_000)
      await ask(subject, HOST_EMAIL).expect(202)
      await mailed(subject, 2)

      const replaced = await confirm(subject, old)
      subject.clock.advance(60 * 60 * 1000)
      const expired = await confirm(subject, tokenInLastMail(subject))

      expect(replaced.body.error.code).toBe('auth.invalidToken')
      expect(expired.body.error.code).toBe('auth.invalidToken')
    })

    it('answers the same 400 for a token nobody issued, one spent and one expired', async () => {
      const subject = harness()
      seedHost(subject)
      const spent = await askAndRead(subject)
      await confirm(subject, spent).expect(204)

      const answers = [await confirm(subject, spent), await confirm(subject, 'x'.repeat(43))]

      expect(answers[0]?.body).toEqual(answers[1]?.body)
      expect(answers[0]?.status).toBe(answers[1]?.status)
    })

    it('does not spend the link on a password the policy refuses', async () => {
      const subject = harness()
      seedHost(subject)
      const token = await askAndRead(subject)

      const weak = await confirm(subject, token, 'court')
      const good = await confirm(subject, token)

      expect(weak.status).toBe(400)
      expect(weak.body.error.code).toBe('password.tooShort')
      expect(good.status).toBe(204)
    })

    it('forbids any cache from storing the answer', async () => {
      const subject = harness()

      expect((await confirm(subject, 'x'.repeat(43))).headers['cache-control']).toBe('no-store')
    })

    it.each([
      ['no body', {}],
      ['no password', { token: 'abc' }],
      ['no token', { password: NEW }],
      ['an empty token', { token: '', password: NEW }],
      ['a token far longer than any real one', { token: 'a'.repeat(300), password: NEW }],
      ['an unknown key', { token: 'abc', password: NEW, email: HOST_EMAIL }],
    ])('answers 400 request.invalid for %s', async (_label, body) => {
      const subject = harness()

      const response = await request(subject.app)
        .post('/api/auth/password-reset/confirm')
        .send(body)

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('request.invalid')
    })

    it('answers 429 once the per-minute limit is spent', async () => {
      const subject = harness({
        config: { rateLimits: { ...testHttpConfig().rateLimits, loginPerMinute: 2 } },
      })

      await confirm(subject, 'a'.repeat(43))
      await confirm(subject, 'b'.repeat(43))
      const third = await confirm(subject, 'c'.repeat(43))

      expect(third.status).toBe(429)
    })

    it('keeps the two limits apart: asking for a link does not spend the allowance for using one', async () => {
      const subject = harness({
        config: { rateLimits: { ...testHttpConfig().rateLimits, loginPerMinute: 2 } },
      })
      await ask(subject, 'un@example.test')
      await ask(subject, 'deux@example.test')

      const response = await confirm(subject, 'a'.repeat(43))

      expect(response.status).toBe(400)
    })

    it('refuses a state-changing call without the CSRF token like every other write', async () => {
      const subject = harness({ csrf: true })

      const response = await confirm(subject, 'a'.repeat(43))

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('request.csrfMissing')
    })
  })
})

describe('the CSRF token across a change of identity', () => {
  const csrfToken = (headers: Record<string, unknown>): string | undefined =>
    cookieValue(headers, CSRF_COOKIE)

  /** An agent holding a freshly issued token, as a browser that has loaded a page has. */
  const withToken = async (subject: AuthHarness) => {
    const agent = request.agent(subject.app)
    const token = csrfToken((await agent.get('/api/auth/me').expect(200)).headers)
    if (token === undefined) throw new Error('the server issued no CSRF cookie')
    return { agent, token }
  }

  const login = (agent: ReturnType<typeof request.agent>, token: string) =>
    agent.post('/api/auth/login').set(CSRF_HEADER, token).send({
      email: HOST_EMAIL,
      password: PASSWORD,
    })

  it('replaces the token on a login, so one token never spans two identities', async () => {
    const subject = harness({ csrf: true })
    seedHost(subject)
    const { agent, token } = await withToken(subject)

    const response = await login(agent, token)

    expect(response.status).toBe(200)
    expect(csrfToken(response.headers)).toBeTruthy()
    expect(csrfToken(response.headers)).not.toBe(token)
  })

  it('lets a state-changing request through immediately after the login', async () => {
    // The half that matters to the host: they sign in and land on a screen that writes.
    // `/api/auth/password` is the first thing an invited moderator posts, and it is
    // behind the gate like everything else.
    const subject = harness({ csrf: true })
    seedHost(subject)
    const { agent, token } = await withToken(subject)

    const rotated = csrfToken((await login(agent, token)).headers)
    if (rotated === undefined) throw new Error('the login issued no CSRF cookie')
    const response = await agent
      .post('/api/auth/password')
      .set(CSRF_HEADER, rotated)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })

    expect(response.status).toBe(204)
  })

  it('replaces the token on a logout, so it does not outlive the session it travelled with', async () => {
    // The session is destroyed and its cookie cleared; a token that carried over would
    // still be the valid half held by every page opened during that session — on a
    // shared laptop, by the next person to use it.
    const subject = harness({ csrf: true })
    const { agent, token } = await withToken(subject)
    await agent.post('/test/sign-in').expect(204)

    const response = await agent.post('/api/auth/logout').set(CSRF_HEADER, token)

    expect(response.status).toBe(204)
    expect(csrfToken(response.headers)).toBeTruthy()
    expect(csrfToken(response.headers)).not.toBe(token)
  })

  it('lets a state-changing request through immediately after the logout', async () => {
    // A signed-out browser is not a browser with nothing to do: the join page and the
    // guest upload are public. So the logout issues a fresh anonymous token rather than
    // clearing the cookie, and the next write works with it.
    const subject = harness({ csrf: true })
    const { agent, token } = await withToken(subject)
    await agent.post('/test/sign-in').expect(204)

    const rotated = csrfToken(
      (await agent.post('/api/auth/logout').set(CSRF_HEADER, token)).headers,
    )
    if (rotated === undefined) throw new Error('the logout issued no CSRF cookie')

    await agent.post('/api/auth/logout').set(CSRF_HEADER, rotated).expect(204)
  })

  it('replaces nothing when the credentials are refused, since no identity changed', async () => {
    const subject = harness({ csrf: true })
    seedHost(subject)
    const { agent, token } = await withToken(subject)

    const response = await agent
      .post('/api/auth/login')
      .set(CSRF_HEADER, token)
      .send({ email: HOST_EMAIL, password: 'un-autre-mot-de-passe' })

    expect(response.status).toBe(401)
    expect(csrfToken(response.headers)).toBeUndefined()
  })

  it('replaces nothing when session regeneration fails', async () => {
    // The rotation is sequenced after the regeneration precisely so that a login which
    // could not take effect leaves the browser exactly as it found it.
    const subject = harness({
      csrf: true,
      before: (req, _res, next) => {
        req.session.regenerate = (done) => {
          done(new Error('session store unavailable'))
          return req.session
        }
        next()
      },
    })
    seedHost(subject)
    const { agent, token } = await withToken(subject)

    const response = await login(agent, token)

    expect(response.status).toBe(500)
    expect(csrfToken(response.headers)).toBeUndefined()
  })

  it('still refuses a write whose header does not match the rotated cookie', async () => {
    // Rotation must not become a way past the gate: the agent's jar now holds the new
    // token, and a client still echoing the old one is refused like any other mismatch.
    const subject = harness({ csrf: true })
    seedHost(subject)
    const { agent, token } = await withToken(subject)

    await login(agent, token).expect(200)
    const response = await agent
      .post('/api/auth/password')
      .set(CSRF_HEADER, token)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('request.csrfMismatch')
  })
})
