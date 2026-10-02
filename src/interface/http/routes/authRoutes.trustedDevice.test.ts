import { createServer, type Server } from 'node:http'
import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { authRoutes } from './authRoutes'
import {
  TEST_SESSION_SECRET,
  buildHarness,
  testHttpConfig,
  type Harness,
} from '../testing/middlewareHarness'
import { aUser } from '../../../application/testing/builders'
import { FakeAccountTokenRepository } from '../../../application/testing/fakeAccountTokenRepository'
import { FakeMailer } from '../../../application/testing/fakeMailer'
import { FakeSecondFactorRepository } from '../../../application/testing/fakeSecondFactorRepository'
import { FakeSecretTokens } from '../../../application/testing/fakeSecretTokens'
import { FakeUserRepository } from '../../../application/testing/fakeUserRepository'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import type { PasswordHasher } from '../../../application/ports/passwordHasher'
import { makeAuthenticateUser } from '../../../application/usecases/auth/authenticateUser'
import { makeChangePassword } from '../../../application/usecases/auth/changePassword'
import { makeRequestPasswordReset } from '../../../application/usecases/auth/requestPasswordReset'
import { makeResetPassword } from '../../../application/usecases/auth/resetPassword'
import { makeRevokeOtherSessions } from '../../../application/usecases/auth/revokeOtherSessions'
import { asUserId } from '../../../domain/shared/ids'
import type { Password } from '../../../domain/users/password'
import type { PasswordHash } from '../../../domain/users/user'
import { TRUSTED_DEVICE_LIFETIME_MS } from '../../../domain/users/trustedDevice'
import { TRUSTED_DEVICE_COOKIE, trustedDeviceCodec } from '../middleware/trustedDevice'
import { unusedSecondFactorUseCases } from '../testing/signIn'

/**
 * The trusted-device cookie of the sign-in throttle (free plan G3-04b, on top of G3-04 / P4-07),
 * through the real `authRoutes` and the real use cases over fakes.
 *
 * The problem it answers (PR #128, review finding 2): the throttle keys a bucket by the account
 * and the client's /56, so a stranger on the owner's **own** network who knows the address shares
 * the owner's bucket, and one wrong guess every fifteen minutes keeps the owner off that network.
 * Every test here is an invariant of the fix, named for the rule it holds:
 *
 * - a stranger on the same network no longer delays a browser that has signed in before;
 * - the device's own bucket still throttles, from wherever the cookie is presented, and the
 *   per-client limit and the account-wide hold still apply to it;
 * - a cookie that is forged, expired, from the future, for another account or revoked is
 *   ignored, and the request is answered exactly as one with no cookie;
 * - a change of credentials (a password change, "sign out everywhere") ends the trust;
 * - the cookie holds no e-mail address, is set only by a successful password sign-in, and
 *   survives a sign-out.
 *
 * The rule for when a device counts is held one ring down, in
 * `domain/users/trustedDevice.test.ts`; the cookie's format in `middleware/trustedDevice.test.ts`.
 */

const OWNER_ID = 'owner-id'
const OWNER = 'camille@example.test'
const OTHER_ID = 'other-id'
const OTHER = 'autre@example.test'

/** The plaintext behind `builders.aUser`'s default hash. */
const PASSWORD = 'un-mot-de-passe-solide'
const NEW_PASSWORD = 'un-tout-nouveau-mot-de-passe'
const WRONG = 'un-autre-mot-de-passe'

const DAY = 24 * 60 * 60_000

/** `hash:<plaintext>`, like the fake the other route tests use. */
class PlainHasher implements PasswordHasher {
  readonly dummyHash: PasswordHash = 'hash:*no-such-account*'

  async hash(password: Password): Promise<PasswordHash> {
    return `hash:${password.value}`
  }

  async verify(attempt: string, hash: PasswordHash): Promise<boolean> {
    return hash === `hash:${attempt}`
  }

  needsRehash(): boolean {
    return false
  }
}

/**
 * Every subject listens on one port of its own for the whole test, instead of `supertest`
 * opening and closing a server per request: a port per request exhausts a Windows machine's
 * ephemeral range (every closed socket sits in TIME_WAIT for minutes), which then fails
 * unrelated tests in the same run. See `authRoutes.throttle.test.ts`.
 */
const servers: Server[] = []

afterAll(() => {
  for (const server of servers) {
    server.closeAllConnections()
    server.close()
  }
})

interface Subject extends Harness {
  readonly server: Server
  /** The durations the throttle was asked to hold a request for, instead of holding it. */
  readonly holds: number[]
}

interface SubjectOptions {
  /** The per-client limit. Out of the way by default: most of these tests are about the other one. */
  readonly perMinute?: number
  /** The site is served over https. */
  readonly secureCookie?: boolean
  /** Session regeneration fails, as when the store goes away between the password and the cookie. */
  readonly sessionStoreDown?: boolean
}

const subjectOf = ({
  perMinute = 10_000,
  secureCookie = false,
  sessionStoreDown = false,
}: SubjectOptions = {}): Subject => {
  const users = new FakeUserRepository()
  users.seed(aUser({ id: OWNER_ID, email: OWNER, displayName: 'Camille' }))
  users.seed(aUser({ id: OTHER_ID, email: OTHER, displayName: 'Autre' }))
  const hasher = new PlainHasher()
  const mailer = new FakeMailer()
  const tokens = new FakeAccountTokenRepository().withAccounts(asUserId(OWNER_ID))
  const secrets = new FakeSecretTokens()
  const ids = new SequentialIdGenerator()
  const holds: number[] = []

  const built = buildHarness({
    config: {
      secureCookie,
      rateLimits: { ...testHttpConfig().rateLimits, loginPerMinute: perMinute },
    },
    users,
    mailer,
    routes: (app, deps) => {
      // One proxy hop, so `X-Forwarded-For` is the client address: the only way a test can
      // present more than one network, and the deployment this product actually has.
      app.set('trust proxy', 1)
      if (sessionStoreDown) {
        app.use((req, _res, next) => {
          req.session.regenerate = (done) => {
            done(new Error('session store unavailable'))
            return req.session
          }
          next()
        })
      }
      app.use(
        '/api',
        authRoutes({
          deps: { ...deps, users },
          usecases: {
            authenticateUser: makeAuthenticateUser({
              users,
              factors: new FakeSecondFactorRepository(),
              hasher,
              clock: deps.clock,
            }),
            changePassword: makeChangePassword({ users, hasher, clock: deps.clock }),
            revokeOtherSessions: makeRevokeOtherSessions({ users, clock: deps.clock }),
            requestPasswordReset: makeRequestPasswordReset({
              users,
              tokens,
              secrets,
              mailer,
              ids,
              clock: deps.clock,
              logger: deps.logger,
              publicUrl: deps.config.publicUrl,
            }),
            resetPassword: makeResetPassword({ users, tokens, secrets, hasher, clock: deps.clock }),
            ...unusedSecondFactorUseCases,
          },
          throttleHold: async (ms) => {
            holds.push(ms)
          },
        }),
      )
    },
  })

  const server = createServer(built.app)
  server.listen(0)
  servers.push(server)

  return { ...built, server, holds }
}

/** Addresses that are different networks: IPv4 is its own key, and these never share a /56. */
const network = (n: number): string => `198.51.100.${n}`
const HOME = network(1)
/** Where the owner signs in the first time, so that the shared network starts clean. */
const FIRST_SIGN_IN = network(77)

interface Attempt {
  readonly from?: string
  readonly email?: string
  readonly password?: string
  /** A whole `Cookie` header value, e.g. `es_device=…`. */
  readonly cookie?: string | undefined
}

const signIn = (
  subject: Subject,
  { from = HOME, email = OWNER, password = WRONG, cookie }: Attempt = {},
) => {
  const call = request(subject.server)
    .post('/api/auth/login')
    .set('X-Forwarded-For', from)
    .send({ email, password })
  return cookie === undefined ? call : call.set('Cookie', cookie)
}

interface Answer {
  readonly status: number
  readonly body: unknown
  readonly headers: Record<string, unknown>
}

const setCookiesOf = (response: Answer): string[] => {
  const header = response.headers['set-cookie']
  return Array.isArray(header) ? (header as string[]) : []
}

/** The full `Set-Cookie` line for the device cookie, attributes included. */
const deviceSetCookie = (response: Answer): string | undefined =>
  setCookiesOf(response).find((line) => line.startsWith(`${TRUSTED_DEVICE_COOKIE}=`))

/** What a browser would send back: `name=value`, without the attributes. */
const deviceCookieOf = (response: Answer): string => {
  const line = deviceSetCookie(response)
  if (line === undefined) throw new Error('the response set no device cookie')
  return line.split(';')[0] ?? ''
}

/** The session cookie: `es_session` on a real server, `connect.sid` in this harness. */
const sessionCookieOf = (response: Answer): string => {
  const line = setCookiesOf(response).find((candidate) =>
    /^(es_session|connect.sid)=/.test(candidate),
  )
  if (line === undefined) throw new Error('the response set no session cookie')
  return line.split(';')[0] ?? ''
}

/** The value of `es_device=<value>`, URL-decoded as a server reads it. */
const valueOf = (cookie: string): string =>
  decodeURIComponent(cookie.slice(`${TRUSTED_DEVICE_COOKIE}=`.length))

/** Everything a caller can observe of an answer, for comparing two of them. */
const observed = (response: Answer) => ({
  status: response.status,
  body: response.body,
  retryAfter: response.headers['retry-after'],
  setsDeviceCookie: deviceSetCookie(response) !== undefined,
  setsSession: setCookiesOf(response).some((line) => /^(es_session|connect.sid)=/.test(line)),
})

/**
 * The owner signs in with the right password, from a network of their own, and keeps the
 * device cookie that comes back: the browser the whole file is about.
 */
const trustedCookieFor = async (
  subject: Subject,
  { email = OWNER, from = FIRST_SIGN_IN }: { email?: string; from?: string } = {},
): Promise<string> => {
  const response = await signIn(subject, { email, from, password: PASSWORD })
  expect(response.status).toBe(200)
  return deviceCookieOf(response)
}

/**
 * `count` wrong guesses from one network, waiting out every wait it is asked to, so that a
 * test can pile failures up without writing out the arithmetic. The last one has just been
 * made, so the network is inside the wait it earned. A stranger, so no cookie.
 */
const pileUp = async (
  subject: Subject,
  count: number,
  { from = HOME, email = OWNER }: { from?: string; email?: string } = {},
): Promise<void> => {
  let failures = 0
  // Bounded: a throttle that kept asking for longer waits would otherwise loop here for ever.
  for (let tries = 0; failures < count; tries += 1) {
    if (tries > count * 2 + 10) throw new Error(`still being asked to wait after ${tries} tries`)
    const response = await signIn(subject, { from, email })
    if (response.status === 429) {
      subject.clock.advance(Number(response.headers['retry-after']) * 1_000)
    } else {
      expect(response.status).toBe(401)
      failures += 1
    }
  }
}

describe('the trusted-device cookie, as a sign-in sets it', () => {
  it('is set by a successful sign-in: HttpOnly, SameSite=Strict, on /api/auth only, for ninety days', async () => {
    const subject = subjectOf()

    const response = await signIn(subject, { password: PASSWORD })

    const line = deviceSetCookie(response)
    expect(line).toBeDefined()
    expect(line).toMatch(new RegExp(`^${TRUSTED_DEVICE_COOKIE}=v1\\.`))
    expect(line).toContain('; HttpOnly')
    expect(line).toContain('; SameSite=Strict')
    expect(line).toContain('; Path=/api/auth')
    expect(line).toContain(`; Max-Age=${TRUSTED_DEVICE_LIFETIME_MS / 1_000}`)
    expect(TRUSTED_DEVICE_LIFETIME_MS).toBe(90 * DAY)
    expect(line).not.toContain('; Secure')
    expect(line).not.toContain('Domain=')
  })

  it('is Secure when the site is served over https', async () => {
    const subject = subjectOf({ secureCookie: true })

    const response = await signIn(subject, { password: PASSWORD })

    expect(deviceSetCookie(response)).toContain('; Secure')
  })

  it('carries no e-mail address and nothing of the credentials: an opaque device id, the account id and the instant', async () => {
    const subject = subjectOf()

    const cookie = await trustedCookieFor(subject)

    const [version, payload, mac] = valueOf(cookie).split('.')
    expect(version).toBe('v1')
    expect(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8'))).toEqual({
      d: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/) as unknown,
      u: OWNER_ID,
      i: subject.clock.now().getTime(),
    })
    expect(mac).toMatch(/^[A-Za-z0-9_-]{43}$/)
    for (const secret of [OWNER, 'camille', 'example.test', PASSWORD, `hash:${PASSWORD}`]) {
      expect(cookie).not.toContain(secret)
      expect(Buffer.from(payload ?? '', 'base64url').toString('utf8')).not.toContain(secret)
    }
    expect(cookie).not.toContain(Buffer.from(OWNER).toString('base64url'))
  })

  it('gives each sign-in a device id of its own', async () => {
    const subject = subjectOf()

    const first = await trustedCookieFor(subject)
    const second = await trustedCookieFor(subject)

    expect(valueOf(first).split('.')[1]).not.toBe(valueOf(second).split('.')[1])
  })

  it('is not set by anything but a successful password sign-in', async () => {
    const subject = subjectOf({ perMinute: 6 })
    await pileUp(subject, 5)
    const refusedByWait = await signIn(subject)
    const malformed = await request(subject.server)
      .post('/api/auth/login')
      .set('X-Forwarded-For', network(5))
      .send({ email: OWNER })
    const wrong = await signIn(subject, { from: network(6) })
    const unknown = await signIn(subject, { from: network(7), email: 'inconnu@example.test' })

    expect([refusedByWait.status, malformed.status, wrong.status, unknown.status]).toEqual([
      429, 400, 401, 401,
    ])
    for (const response of [refusedByWait, malformed, wrong, unknown]) {
      expect(deviceSetCookie(response)).toBeUndefined()
    }
  })

  it('is not set by a sign-in that failed on the server after the right password', async () => {
    const subject = subjectOf({ sessionStoreDown: true })

    const response = await signIn(subject, { password: PASSWORD })

    expect(response.status).toBe(500)
    expect(setCookiesOf(response)).toEqual([])
  })

  it('is set again by a password change, which has just proved the current password: the browser that chose it stays trusted', async () => {
    const subject = subjectOf()
    const login = await signIn(subject, { from: FIRST_SIGN_IN, password: PASSWORD })
    subject.clock.advance(1_000)

    const changed = await request(subject.server)
      .post('/api/auth/password')
      .set('Cookie', sessionCookieOf(login))
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
    await pileUp(subject, 8)
    const stale = await signIn(subject, { cookie: deviceCookieOf(login) })
    const fresh = await signIn(subject, { cookie: deviceCookieOf(changed) })

    expect(changed.status).toBe(204)
    expect(deviceSetCookie(changed)).toBeDefined()
    // The shared network is in the stranger's wait: the old cookie is not trusted any more (the
    // change ended it), the one the change set is.
    expect([stale.status, fresh.status]).toEqual([429, 401])
  })

  it('is not set by a password change that did not prove the current password, nor by "sign out everywhere": a stolen session must not be able to mint a device', async () => {
    const subject = subjectOf()
    const login = await signIn(subject, { password: PASSWORD })
    const session = sessionCookieOf(login)

    subject.clock.advance(1_000)
    const guessed = await request(subject.server)
      .post('/api/auth/password')
      .set('Cookie', session)
      .send({ currentPassword: WRONG, newPassword: NEW_PASSWORD })
    const revoked = await request(subject.server)
      .post('/api/auth/sessions/revoke-others')
      .set('Cookie', session)

    expect([guessed.status, revoked.status]).toEqual([401, 204])
    expect(deviceSetCookie(guessed)).toBeUndefined()
    expect(deviceSetCookie(revoked)).toBeUndefined()
  })

  it('survives a sign-out: logging out does not clear it, and the browser still counts', async () => {
    const subject = subjectOf()
    const login = await signIn(subject, { from: FIRST_SIGN_IN, password: PASSWORD })
    const cookie = deviceCookieOf(login)

    const logout = await request(subject.server)
      .post('/api/auth/logout')
      .set('Cookie', `${sessionCookieOf(login)}; ${cookie}`)
    await pileUp(subject, 8)
    const owner = await signIn(subject, { cookie })

    expect(logout.status).toBe(204)
    expect(setCookiesOf(logout).join('\n')).not.toContain(TRUSTED_DEVICE_COOKIE)
    expect(owner.status).toBe(401)
  })

  it('is renewed at every successful sign-in, counting its ninety days from that one', async () => {
    const subject = subjectOf()
    const first = await trustedCookieFor(subject)

    subject.clock.advance(60 * DAY)
    const second = deviceCookieOf(await signIn(subject, { password: PASSWORD, cookie: first }))
    subject.clock.advance(40 * DAY)
    await pileUp(subject, 8)

    // 100 days after the first sign-in and 40 after the second.
    expect((await signIn(subject, { cookie: second })).status).toBe(401)
    expect((await signIn(subject, { cookie: first })).status).toBe(429)
  })
})

describe('a stranger on the owner’s own network', () => {
  it('no longer delays a browser that has signed in before', async () => {
    const subject = subjectOf()
    const cookie = await trustedCookieFor(subject)

    await pileUp(subject, 12)
    const wrong = await signIn(subject, { cookie })
    const right = await signIn(subject, { password: PASSWORD, cookie })

    // The stranger has earned the shared network a wait of two minutes; the owner's browser
    // is not in it. A wrong password is an ordinary failure and the right one signs in.
    expect(wrong.status).toBe(401)
    expect(right.status).toBe(200)
    expect(right.body.email).toBe(OWNER)
  })

  it('still delays a browser that has no cookie, as before: the network bucket is unchanged', async () => {
    const subject = subjectOf()
    await trustedCookieFor(subject)

    await pileUp(subject, 12)
    const privateWindow = await signIn(subject, { password: PASSWORD })

    expect(privateWindow.status).toBe(429)
    expect(Number(privateWindow.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('does not let the owner’s typos on their browser delay anybody else on the network', async () => {
    const subject = subjectOf()
    const cookie = await trustedCookieFor(subject)

    for (let typo = 0; typo < 8; typo += 1) {
      subject.clock.advance(60_000)
      await signIn(subject, { cookie })
    }
    const colleague = await signIn(subject, { password: PASSWORD })

    expect(colleague.status).toBe(200)
  })

  it('recognises the browser whatever the spelling of the address', async () => {
    const subject = subjectOf()
    const cookie = await trustedCookieFor(subject)
    await pileUp(subject, 12)

    for (const email of [OWNER, 'CAMILLE@example.test', ` ${OWNER} `, 'Camille@Example.Test']) {
      expect((await signIn(subject, { email, cookie })).status).toBe(401)
      subject.clock.advance(60_000)
    }
  })
})

describe('the trusted device’s own bucket still throttles', () => {
  it('lets five wrong passwords through, then waits one second, doubling up to fifteen minutes', async () => {
    const subject = subjectOf()
    const cookie = await trustedCookieFor(subject)

    for (let n = 0; n < 5; n += 1) expect((await signIn(subject, { cookie })).status).toBe(401)
    const waits: number[] = []
    for (let round = 0; round < 12; round += 1) {
      const refused = await signIn(subject, { cookie })
      expect(refused.status).toBe(429)
      expect(refused.body.error.code).toBe('rate.limited')
      const seconds = Number(refused.headers['retry-after'])
      waits.push(seconds)
      subject.clock.advance(seconds * 1_000)
      expect((await signIn(subject, { cookie })).status).toBe(401)
    }

    expect(waits).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 900, 900])
  })

  it('refuses even the right password while its wait runs, and accepts it when the wait is over', async () => {
    const subject = subjectOf()
    const cookie = await trustedCookieFor(subject)
    for (let n = 0; n < 7; n += 1) {
      const response = await signIn(subject, { cookie })
      if (response.status === 429)
        subject.clock.advance(Number(response.headers['retry-after']) * 1_000)
    }
    const refused = await signIn(subject, { cookie })
    expect(refused.status).toBe(429)

    const during = await signIn(subject, { password: PASSWORD, cookie })
    subject.clock.advance(Number(refused.headers['retry-after']) * 1_000)
    const after = await signIn(subject, { password: PASSWORD, cookie })

    expect(during.status).toBe(429)
    expect(after.status).toBe(200)
  })

  it('is one bucket wherever the cookie is presented: a stolen cookie never buys unlimited tries', async () => {
    const subject = subjectOf()
    const cookie = await trustedCookieFor(subject)

    const statuses: number[] = []
    for (let n = 0; n < 20; n += 1) {
      statuses.push((await signIn(subject, { from: network(100 + n), cookie })).status)
    }

    expect(statuses).toEqual([
      ...Array.from({ length: 5 }, () => 401),
      ...Array.from({ length: 15 }, () => 429),
    ])
  })

  it('clears its wait on a success, and leaves the network’s wait where it was', async () => {
    const subject = subjectOf()
    const cookie = await trustedCookieFor(subject)
    await pileUp(subject, 12)
    for (let n = 0; n < 7; n += 1) {
      const response = await signIn(subject, { cookie })
      if (response.status === 429)
        subject.clock.advance(Number(response.headers['retry-after']) * 1_000)
    }
    const waiting = await signIn(subject, { cookie })
    expect(waiting.status).toBe(429)
    subject.clock.advance(Number(waiting.headers['retry-after']) * 1_000)
    expect((await signIn(subject, { password: PASSWORD, cookie })).status).toBe(200)

    // Same browser, same cookie: five free tries again. The shared network is still in its wait.
    for (let n = 0; n < 5; n += 1) expect((await signIn(subject, { cookie })).status).toBe(401)
    expect((await signIn(subject, { password: PASSWORD })).status).toBe(429)
  })

  it('is still behind the per-client limit, which counts across accounts and cookies', async () => {
    const subject = subjectOf({ perMinute: 4 })
    const cookie = await trustedCookieFor(subject)

    const answers = [
      await signIn(subject, { cookie }),
      await signIn(subject, { email: OTHER }),
      await signIn(subject, { email: 'inconnu@example.test' }),
      await signIn(subject, { email: OTHER, cookie }),
      await signIn(subject, { cookie }),
    ]

    // Four requests from one address, three accounts and two cookie states: the fifth is the
    // client limit's. Its body names no wait; the device's own would.
    expect(answers.map((answer) => answer.status)).toEqual([401, 401, 401, 401, 429])
    expect(answers[4]?.body.error.details).toEqual({})
  })

  it('gives back an attempt that was not a wrong guess: a server failure after the right password is no failure of the device', async () => {
    const subject = subjectOf({ sessionStoreDown: true })
    // The store is down, so no sign-in can issue a cookie: seal one, as the table below does.
    const cookie = `${TRUSTED_DEVICE_COOKIE}=${trustedDeviceCodec(TEST_SESSION_SECRET).seal(
      { device: 'sealed-device', userId: OWNER_ID, issuedAtMs: subject.clock.now().getTime() },
      OWNER,
    )}`
    for (let n = 0; n < 4; n += 1) expect((await signIn(subject, { cookie })).status).toBe(401)

    expect((await signIn(subject, { password: PASSWORD, cookie })).status).toBe(500)

    // Four failures stand, so one more is the fifth and the one after it waits.
    expect((await signIn(subject, { cookie })).status).toBe(401)
    expect((await signIn(subject, { cookie })).status).toBe(429)
  })

  it('is still held two seconds, and never refused, once the account is being stuffed from everywhere', async () => {
    const subject = subjectOf()
    const cookie = await trustedCookieFor(subject)
    for (let n = 1; n <= 100; n += 1) {
      expect((await signIn(subject, { from: `203.0.113.${n}` })).status).toBe(401)
    }
    expect(subject.holds).toEqual([])

    const owner = await signIn(subject, { password: PASSWORD, cookie })

    expect(owner.status).toBe(200)
    expect(subject.holds).toEqual([2_000])
  })

  it('counts its failures in the account-wide hold with the networks’ failures', async () => {
    const subject = subjectOf()
    const cookie = await trustedCookieFor(subject)
    for (let n = 1; n <= 50; n += 1) await signIn(subject, { from: `203.0.113.${n}` })
    // The owner's browser is one device, so it can only make five free failures, then waits.
    for (let n = 0; n < 5; n += 1) await signIn(subject, { cookie })
    // A second sign-in from a second browser of the owner's gives a second device, five more.
    const second = await trustedCookieFor(subject, { from: network(78) })
    for (let n = 0; n < 5; n += 1) await signIn(subject, { cookie: second })
    for (let n = 51; n <= 90; n += 1) await signIn(subject, { from: `203.0.113.${n}` })
    expect(subject.holds).toEqual([])

    // 50 + 5 + 5 + 40 = 100 failures: the next attempt, from anywhere, is held.
    await signIn(subject, { from: network(150) })

    expect(subject.holds).toEqual([2_000])
  })
})

describe('a cookie that does not count is ignored, and answered exactly as no cookie', () => {
  /**
   * The stranger holds the shared network in a wait; the owner's browser then tries a wrong
   * password, the right one during the wait, and the right one after it. With a cookie that
   * counts the first two are `401` and `200`; without one they are `429` and `429`.
   */
  const ownerOnSharedWifi = async (subject: Subject, cookie: string | undefined) => {
    await pileUp(subject, 8)
    const seen = [
      observed(await signIn(subject, { cookie })),
      observed(await signIn(subject, { password: PASSWORD, cookie })),
    ]
    subject.clock.advance(8_000)
    seen.push(observed(await signIn(subject, { password: PASSWORD, cookie })))
    return seen
  }

  const sealWith = (secret: string, overrides: { userId?: string; issuedAtMs?: number } = {}) => {
    return (subject: Subject, address: string = OWNER): string =>
      `${TRUSTED_DEVICE_COOKIE}=${trustedDeviceCodec(secret).seal(
        {
          device: 'forged-device',
          userId: overrides.userId ?? OWNER_ID,
          issuedAtMs: overrides.issuedAtMs ?? subject.clock.now().getTime(),
        },
        address,
      )}`
  }

  const flip = (cookie: string, at: number): string => {
    const char = cookie.charAt(at)
    return `${cookie.slice(0, at)}${char === 'A' ? 'B' : 'A'}${cookie.slice(at + 1)}`
  }

  const variants: readonly (readonly [string, (subject: Subject) => Promise<string>])[] = [
    [
      'signed with another secret',
      async (s) => sealWith('another-secret-of-more-than-32-characters')(s),
    ],
    ['signed for another address', async (s) => sealWith(TEST_SESSION_SECRET)(s, OTHER)],
    [
      'from the future',
      async (s) => sealWith(TEST_SESSION_SECRET, { issuedAtMs: s.clock.now().getTime() + DAY })(s),
    ],
    [
      'with a tampered signature',
      async (s) => {
        const cookie = await trustedCookieFor(s)
        return flip(cookie, cookie.length - 3)
      },
    ],
    [
      'with a tampered payload',
      async (s) => {
        const cookie = await trustedCookieFor(s)
        return flip(cookie, TRUSTED_DEVICE_COOKIE.length + '=v1.'.length + 4)
      },
    ],
    [
      'issued to another account',
      async (s) => trustedCookieFor(s, { email: OTHER, from: network(78) }),
    ],
    [
      'expired',
      async (s) => {
        const cookie = await trustedCookieFor(s)
        s.clock.advance(TRUSTED_DEVICE_LIFETIME_MS)
        return cookie
      },
    ],
    [
      'from before the account’s credentials changed',
      async (s) => {
        const cookie = await trustedCookieFor(s)
        s.clock.advance(1_000)
        const login = await signIn(s, { from: network(79), password: PASSWORD })
        const revoked = await request(s.server)
          .post('/api/auth/sessions/revoke-others')
          .set('Cookie', sessionCookieOf(login))
        expect(revoked.status).toBe(204)
        s.clock.advance(1_000)
        return cookie
      },
    ],
    ['empty', async () => `${TRUSTED_DEVICE_COOKIE}=`],
    ['a bare version', async () => `${TRUSTED_DEVICE_COOKIE}=v1`],
    ['three empty parts', async () => `${TRUSTED_DEVICE_COOKIE}=v1..`],
    [
      'the right shape and nothing else',
      async () => `${TRUSTED_DEVICE_COOKIE}=v1.${'a'.repeat(40)}.${'b'.repeat(43)}`,
    ],
    [
      'a value cookie-parser reads as JSON',
      async () => `${TRUSTED_DEVICE_COOKIE}=${encodeURIComponent('j:{"a":1}')}`,
    ],
    [
      'a signature the right length in characters and the wrong one in bytes',
      async (s) => {
        const cookie = await trustedCookieFor(s)
        const head = cookie.slice(0, cookie.lastIndexOf('.') + 1)
        return head + encodeURIComponent(String.fromCharCode(0xe9).repeat(43))
      },
    ],
    [
      'far too long',
      async () => `${TRUSTED_DEVICE_COOKIE}=v1.${'a'.repeat(5_000)}.${'b'.repeat(43)}`,
    ],
  ]

  it('answers each of them with the status, body, Retry-After and cookies of a request with no cookie at all', async () => {
    const control = await ownerOnSharedWifi(subjectOf(), undefined)
    // Not vacuous: without a cookie the owner is held with the stranger, and signs in after.
    expect(control.map((step) => step.status)).toEqual([429, 429, 200])
    expect(control[0]?.retryAfter).toBe('8')

    for (const [, prepare] of variants) {
      const subject = subjectOf()
      const cookie = await prepare(subject)
      expect(await ownerOnSharedWifi(subject, cookie)).toEqual(control)
    }
  })

  it('does not let a valid cookie of the same kind through by accident: the control for the table above', async () => {
    const subject = subjectOf()
    const cookie = await trustedCookieFor(subject)

    const seen = await ownerOnSharedWifi(subject, cookie)

    expect(seen.map((step) => step.status)).toEqual([401, 200, 200])
  })

  it('gives another account nothing from this one’s cookie, in either direction', async () => {
    const subject = subjectOf()
    const ownersCookie = await trustedCookieFor(subject)
    const others = await trustedCookieFor(subject, { email: OTHER, from: network(78) })
    await pileUp(subject, 8, { email: OWNER })
    await pileUp(subject, 8, { email: OTHER })

    // The shared network is in a wait for each of them; the other's cookie lifts neither.
    expect((await signIn(subject, { email: OWNER, cookie: others })).status).toBe(429)
    expect((await signIn(subject, { email: OTHER, cookie: ownersCookie })).status).toBe(429)
    // Each one's own cookie does, for its own address.
    expect((await signIn(subject, { email: OWNER, cookie: ownersCookie })).status).toBe(401)
    expect((await signIn(subject, { email: OTHER, cookie: others })).status).toBe(401)
  })
})

describe('the credentials epoch ends the trust', () => {
  const raisers: readonly (readonly [
    string,
    (subject: Subject, session: string) => Promise<Answer>,
  ])[] = [
    [
      'a password change',
      async (subject, session) => {
        const response = await request(subject.server)
          .post('/api/auth/password')
          .set('Cookie', session)
          .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        expect(response.status).toBe(204)
        return response
      },
    ],
    [
      '"sign out everywhere"',
      async (subject, session) => {
        const response = await request(subject.server)
          .post('/api/auth/sessions/revoke-others')
          .set('Cookie', session)
        expect(response.status).toBe(204)
        return response
      },
    ],
  ]

  for (const [name, raise] of raisers) {
    it(`stops counting after ${name}, and counts again after the next successful sign-in`, async () => {
      const subject = subjectOf()
      const stale = await trustedCookieFor(subject)
      subject.clock.advance(1_000)
      await pileUp(subject, 12)

      // Trusted, to start with: a session to change the credentials from.
      const login = await signIn(subject, { password: PASSWORD, cookie: stale })
      expect(login.status).toBe(200)
      subject.clock.advance(1_000)
      const raised = await raise(subject, sessionCookieOf(login))
      subject.clock.advance(1_000)

      // The cookie is older than the change: it is not there, and neither is its estate. The
      // shared network is still in the stranger's wait.
      const afterwards = await signIn(subject, { cookie: stale })
      const alsoTheRenewedOne = await signIn(subject, { cookie: deviceCookieOf(login) })
      expect([afterwards.status, alsoTheRenewedOne.status]).toEqual([429, 429])
      // Only a request that proved the password sets a new one at once.
      if (name === 'a password change') {
        expect((await signIn(subject, { cookie: deviceCookieOf(raised) })).status).toBe(401)
      } else {
        expect(deviceSetCookie(raised)).toBeUndefined()
      }

      // A successful sign-in sets a new one, stamped after the change, and it counts.
      subject.clock.advance(Number(afterwards.headers['retry-after']) * 1_000)
      const password = name === 'a password change' ? NEW_PASSWORD : PASSWORD
      const again = await signIn(subject, { password, cookie: stale })
      expect(again.status).toBe(200)
      const fresh = deviceCookieOf(again)
      await pileUp(subject, 12)
      expect((await signIn(subject, { cookie: fresh })).status).toBe(401)
    })
  }

  it('stops counting for an account that was switched off', async () => {
    const subject = subjectOf()
    const cookie = await trustedCookieFor(subject)
    const owner = await subject.users.findById(asUserId(OWNER_ID))
    if (owner === null) throw new Error('the owner was seeded')
    await subject.users.save(owner.disable(subject.clock.now()))
    await pileUp(subject, 8)

    const answer = await signIn(subject, { cookie })

    expect(answer.status).toBe(429)
  })
})
