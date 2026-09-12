import type { RequestHandler } from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { SESSION_COOKIE, authRoutes } from './authRoutes'
import { GUEST_COOKIE } from '../middleware/authz'
import { CSRF_COOKIE, CSRF_HEADER, issueCsrfToken, requireCsrfToken } from '../middleware/csrf'
import { buildHarness, signInAs, testHttpConfig, type Harness } from '../testing/middlewareHarness'
import type { HttpConfig } from '../types'
import { AT, aUser } from '../../../application/testing/builders'
import { FakeUserRepository } from '../../../application/testing/fakeUserRepository'
import type { PasswordHasher } from '../../../application/ports/passwordHasher'
import { makeAuthenticateUser } from '../../../application/usecases/auth/authenticateUser'
import { makeChangePassword } from '../../../application/usecases/auth/changePassword'
import type { Password } from '../../../domain/users/password'
import type { PasswordHash } from '../../../domain/users/user'

const HOST_ID = 'host-id'
const HOST_EMAIL = 'camille@example.test'
const FORMER_EMAIL = 'ancienne@example.test'

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
}

const harness = ({
  config = {},
  before = passThrough,
  csrf = false,
}: AuthHarnessOptions = {}): AuthHarness => {
  const users = new FakeUserRepository()
  const hasher = new FakePasswordHasher()

  const built = buildHarness({
    config,
    routes: (app, deps) => {
      // Two sign-in routes so a test can establish a session without driving a real
      // login: the routes under test then fail for one reason each. Outside `/api`, so
      // they stay reachable when the gate below is mounted.
      app.post('/test/sign-in', signInAs({ userId: HOST_ID, email: HOST_EMAIL }))
      app.post(
        '/test/sign-in/invited',
        signInAs({ userId: HOST_ID, email: HOST_EMAIL, mustChangePassword: true }),
      )

      if (csrf) {
        app.use(issueCsrfToken({ secureCookie: deps.config.secureCookie }))
        app.use('/api', requireCsrfToken)
      }

      app.use(before)
      app.use(
        '/api',
        authRoutes({
          deps,
          // The bag `authRoutes` asks for, built from fakes here: the HTTP layer is
          // never given a user repository, so a route test has to compose the two use
          // cases itself.
          usecases: {
            authenticateUser: makeAuthenticateUser({ users, hasher, clock: deps.clock }),
            changePassword: makeChangePassword({ users, hasher }),
          },
        }),
      )
    },
  })

  return { ...built, users }
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
    // `displayName` is null by design: the session carries an identity and nothing
    // that goes stale, and reading the row would make this controller touch a
    // repository. The login response is what carries the fresh name.
    const subject = harness()
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
      },
    })
  })
})

describe('POST /api/auth/password', () => {
  const change = { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }

  it('clears the forced-change flag in the session on success', async () => {
    // Otherwise the invited moderator's "choose a password" gate stays shut until a
    // reload, on the one screen they cannot get past.
    const subject = harness()
    subject.users.seed(
      aUser({ id: HOST_ID, email: HOST_EMAIL, displayName: 'Camille', mustChangePassword: true }),
    )
    const agent = await signedIn(subject, '/test/sign-in/invited')

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

  it('answers 404 when the session names an account that no longer exists', async () => {
    // A session outliving its user: the id came from a session, so a miss means the
    // account was deleted underneath it — never that the caller guessed wrong.
    const subject = harness()
    const agent = await signedIn(subject)

    const response = await agent.post('/api/auth/password').send(change)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('user.notFound')
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
