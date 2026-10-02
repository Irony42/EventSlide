import type request from 'supertest'
import { describe, expect, it } from 'vitest'
import { AT, aUser } from '../../../application/testing/builders'
import { FakeClock } from '../../../application/testing/fakeClock'
import { FakeSecondFactorRepository } from '../../../application/testing/fakeSecondFactorRepository'
import { FakeUserRepository } from '../../../application/testing/fakeUserRepository'
import {
  EMAIL,
  PASSWORD,
  USER,
  aSecondFactorWorld,
} from '../../../application/testing/secondFactorWorld'
import { makeChangePassword } from '../../../application/usecases/auth/changePassword'
import { decodeBase32 } from '../../../domain/users/base32'
import { CSRF_COOKIE, CSRF_HEADER } from '../middleware/csrf'
import { buildServerHarness } from '../testing/serverHarness'
import { testHttpConfig } from '../testing/middlewareHarness'
import { anonymousCaller, setCookies } from '../testing/signIn'

/**
 * Ring 4. The second factor through the assembled server (`buildServer`, the real middleware
 * order, a real session store), over fakes.
 *
 * Every case is a sentence about what a caller can and cannot do, and the sentences that matter
 * most are the refusals: a half-finished sign-in is not a session, a session that has not passed
 * the factor reaches nothing under `/api/site`, a code is spent once, and a thief's session does
 * not outlive an enrolment.
 */

const FIVE_MINUTES = 5 * 60 * 1000

interface ServerOptions {
  readonly requireForOperators?: boolean
  /** Whether the box has a key. Defaults to yes. */
  readonly available?: boolean
  readonly siteRole?: 'operator' | 'none'
}

const aServer = ({
  requireForOperators = false,
  available = true,
  siteRole = 'operator',
}: ServerOptions = {}) => {
  const clock = new FakeClock(AT)
  const users = new FakeUserRepository()
  const factors = new FakeSecondFactorRepository()
  const world = aSecondFactorWorld({ clock, users, factors, siteRole, withVault: available })

  const harness = buildServerHarness({
    users,
    secondFactors: factors,
    clock,
    config: {
      siteAdmin: true,
      secondFactor: { available, requiredForOperators: requireForOperators },
      // Wide enough that the per-address limiter is not what these cases meet; the per-account
      // budget has a case of its own.
      rateLimits: { ...testHttpConfig().rateLimits, loginPerMinute: 1_000 },
    },
    usecases: {
      authenticateUser: world.authenticateUser,
      verifySecondFactor: world.verifySecondFactor,
      enrollTotp: world.enrollTotp,
      confirmTotpEnrollment: world.confirmTotpEnrollment,
      stepUp: world.stepUp,
      regenerateRecoveryCodes: world.regenerateRecoveryCodes,
      disableSecondFactor: world.disableSecondFactor,
      changePassword: makeChangePassword({ users, hasher: world.hasher, clock }),
    },
  })
  return { world, clock, users, factors, app: harness.app }
}

type Server = ReturnType<typeof aServer>

/** A browser: one cookie jar, and the CSRF token it was last handed. */
const aBrowser = async (server: Server) => {
  const { agent, csrf } = await anonymousCaller(server.app)
  let token = csrf
  const remember = (response: request.Response): request.Response => {
    const cookie = setCookies(response.headers).find((value) => value.startsWith(`${CSRF_COOKIE}=`))
    if (cookie !== undefined) {
      token = decodeURIComponent(cookie.slice(`${CSRF_COOKIE}=`.length).split(';')[0] ?? '')
    }
    return response
  }
  return {
    post: async (path: string, body: object = {}) =>
      remember(await agent.post(path).set(CSRF_HEADER, token).send(body)),
    get: async (path: string) => remember(await agent.get(path)),
    signIn: async () =>
      remember(
        await agent
          .post('/api/auth/login')
          .set(CSRF_HEADER, token)
          .send({ email: EMAIL, password: PASSWORD }),
      ),
  }
}

type Browser = Awaited<ReturnType<typeof aBrowser>>

const codeOf = (response: request.Response): string | undefined =>
  (response.body as { error?: { code?: string } }).error?.code

/** An operator who enrolled, on a fresh server whose clock stands one step after the enrolment. */
const anEnrolledServer = async (options: ServerOptions = {}) => {
  const server = aServer(options)
  const enrolment = await server.world.enrolled()
  return { server, ...enrolment }
}

/** Signs in with the password and the current code, spending the step. */
const signInWithCode = async (server: Server, browser: Browser, secret: Uint8Array) => {
  await browser.signIn()
  const response = await browser.post('/api/auth/login/2fa', { code: server.world.codeFor(secret) })
  expect(response.status).toBe(200)
  server.clock.advance(30_000)
}

describe('POST /api/auth/login for an account with an authenticator', () => {
  it('signs in an account with no authenticator exactly as it always did', async () => {
    const server = aServer()
    const browser = await aBrowser(server)

    const response = await browser.signIn()

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      userId: USER,
      email: EMAIL,
      displayName: null,
      mustChangePassword: false,
    })
  })

  it('answers that a second step is due, and names no one', async () => {
    const { server } = await anEnrolledServer()
    const browser = await aBrowser(server)

    const response = await browser.signIn()

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ secondFactorRequired: true })
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('starts no session: the half-finished sign-in is anonymous to every gate', async () => {
    const { server } = await anEnrolledServer()
    const browser = await aBrowser(server)
    await browser.signIn()

    const me = await browser.get('/api/auth/me')
    const password = await browser.post('/api/auth/password', {
      currentPassword: PASSWORD,
      newPassword: 'un-autre-mot-de-passe-solide',
    })
    const site = await browser.get('/api/site/anything')
    const enrol = await browser.post('/api/auth/2fa/enroll', { password: PASSWORD })

    expect(me.body).toEqual({ authenticated: false })
    expect([password.status, site.status, enrol.status]).toEqual([401, 401, 401])
  })

  it('refuses a wrong password exactly as it does for an account with no authenticator', async () => {
    const { server } = await anEnrolledServer()
    const browser = await aBrowser(server)

    const response = await browser.post('/api/auth/login', {
      email: EMAIL,
      password: 'nope-nope-nope',
    })

    expect(response.status).toBe(401)
    expect(codeOf(response)).toBe('auth.invalidCredentials')
  })
})

describe('POST /api/auth/login/2fa', () => {
  it('finishes the sign-in with a code from the app, and the session says it passed the factor', async () => {
    const { server, secret } = await anEnrolledServer()
    const browser = await aBrowser(server)
    await browser.signIn()

    const response = await browser.post('/api/auth/login/2fa', {
      code: server.world.codeFor(secret),
    })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      userId: USER,
      email: EMAIL,
      displayName: null,
      mustChangePassword: false,
    })
    const me = await browser.get('/api/auth/me')
    expect(me.body.user.secondFactor).toEqual({
      available: true,
      enrolled: true,
      verified: true,
      required: false,
    })
  })

  it('refuses a code that was already used, even on a fresh sign-in (a replay)', async () => {
    const { server, secret } = await anEnrolledServer()
    const first = await aBrowser(server)
    await first.signIn()
    const code = server.world.codeFor(secret)
    await first.post('/api/auth/login/2fa', { code })

    const thief = await aBrowser(server)
    await thief.signIn()
    const replay = await thief.post('/api/auth/login/2fa', { code })

    expect(replay.status).toBe(401)
    expect(codeOf(replay)).toBe('auth.invalidSecondFactor')
    expect((await thief.get('/api/auth/me')).body).toEqual({ authenticated: false })
  })

  it('refuses a wrong code and lets the right one through afterwards', async () => {
    const { server, secret } = await anEnrolledServer()
    const browser = await aBrowser(server)
    await browser.signIn()

    const wrong = await browser.post('/api/auth/login/2fa', { code: '000000' })
    const right = await browser.post('/api/auth/login/2fa', { code: server.world.codeFor(secret) })

    expect(wrong.status).toBe(401)
    expect(codeOf(wrong)).toBe('auth.invalidSecondFactor')
    expect(right.status).toBe(200)
  })

  it('throws the sign-in away after five wrong codes, so even the right one then needs the password', async () => {
    const { server, secret } = await anEnrolledServer()
    const browser = await aBrowser(server)
    await browser.signIn()

    const answers: (string | undefined)[] = []
    for (let attempt = 0; attempt < 5; attempt += 1) {
      answers.push(codeOf(await browser.post('/api/auth/login/2fa', { code: '000000' })))
    }
    const right = await browser.post('/api/auth/login/2fa', { code: server.world.codeFor(secret) })

    expect(answers).toEqual([
      'auth.invalidSecondFactor',
      'auth.invalidSecondFactor',
      'auth.invalidSecondFactor',
      'auth.invalidSecondFactor',
      'auth.secondFactorExpired',
    ])
    expect(codeOf(right)).toBe('auth.secondFactorExpired')
    expect((await browser.get('/api/auth/me')).body).toEqual({ authenticated: false })
  })

  it('answers expired to a caller who never entered a password', async () => {
    const { server, secret } = await anEnrolledServer()
    const browser = await aBrowser(server)

    const response = await browser.post('/api/auth/login/2fa', {
      code: server.world.codeFor(secret),
    })

    expect(response.status).toBe(401)
    expect(codeOf(response)).toBe('auth.secondFactorExpired')
  })

  it('lets a half-finished sign-in live five minutes and no longer', async () => {
    const { server, secret } = await anEnrolledServer()
    const late = await aBrowser(server)
    const inTime = await aBrowser(server)
    await late.signIn()
    await inTime.signIn()

    server.clock.advance(FIVE_MINUTES)
    const stillOpen = await inTime.post('/api/auth/login/2fa', {
      code: server.world.codeFor(secret),
    })
    server.clock.advance(1)
    const tooLate = await late.post('/api/auth/login/2fa', {
      code: server.world.codeFor(secret, 1),
    })

    expect(stillOpen.status).toBe(200)
    expect(codeOf(tooLate)).toBe('auth.secondFactorExpired')
  })

  it('is over when the account’s credentials changed after the password was typed', async () => {
    const { server, secret } = await anEnrolledServer()
    const browser = await aBrowser(server)
    await browser.signIn()
    server.clock.advance(1_000)
    const user = await server.users.findById(USER)
    await server.users.save(user?.revokeSessionsBefore(server.clock.now()) ?? aUser())

    const response = await browser.post('/api/auth/login/2fa', {
      code: server.world.codeFor(secret),
    })

    expect(codeOf(response)).toBe('auth.secondFactorExpired')
  })

  it('accepts a recovery code once, and a second sign-in with it is refused', async () => {
    const { server, recoveryCodes } = await anEnrolledServer()
    const first = await aBrowser(server)
    await first.signIn()
    const recoveryCode = recoveryCodes[0] ?? ''

    const used = await first.post('/api/auth/login/2fa', { recoveryCode })
    const second = await aBrowser(server)
    await second.signIn()
    const again = await second.post('/api/auth/login/2fa', { recoveryCode })

    expect(used.status).toBe(200)
    expect(again.status).toBe(401)
    expect(codeOf(again)).toBe('auth.invalidSecondFactor')
  })

  it.each([
    ['both a code and a recovery code', { code: '123456', recoveryCode: 'AAAA-AAAA-AAAA-AAAA' }],
    ['neither', {}],
    ['a field of another name', { token: '123456' }],
    ['a code that is not text', { code: 123456 }],
  ])('refuses a body with %s as a malformed request', async (_name, body) => {
    const { server } = await anEnrolledServer()
    const browser = await aBrowser(server)
    await browser.signIn()

    const response = await browser.post('/api/auth/login/2fa', body)

    expect(response.status).toBe(400)
  })

  it('spends one budget per account across every sign-in: ten wrong codes, then nothing is read', async () => {
    const { server, secret } = await anEnrolledServer()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const browser = await aBrowser(server)
      await browser.signIn()
      for (let wrong = 0; wrong < 5; wrong += 1) {
        await browser.post('/api/auth/login/2fa', { code: '000000' })
      }
    }

    const fresh = await aBrowser(server)
    await fresh.signIn()
    const right = await fresh.post('/api/auth/login/2fa', { code: server.world.codeFor(secret) })

    expect(right.status).toBe(429)
    expect(codeOf(right)).toBe('auth.tooManySecondFactorAttempts')
    expect((await fresh.get('/api/auth/me')).body).toEqual({ authenticated: false })
  })

  it('is one budget for every door that takes a code: ten wrong step-ups close the sign-in as well', async () => {
    const { server, secret } = await anEnrolledServer()
    const signedIn = await aBrowser(server)
    await signInWithCode(server, signedIn, secret)
    for (let wrong = 0; wrong < 10; wrong += 1) {
      await signedIn.post('/api/auth/step-up', { password: PASSWORD, code: '000000' })
    }

    const fresh = await aBrowser(server)
    await fresh.signIn()
    const right = await fresh.post('/api/auth/login/2fa', { code: server.world.codeFor(secret) })

    expect(right.status).toBe(429)
    expect(codeOf(right)).toBe('auth.tooManySecondFactorAttempts')
  })

  it('does not charge the owner for codes they typed right', async () => {
    const { server, secret } = await anEnrolledServer()

    for (let signIn = 0; signIn < 12; signIn += 1) {
      await signInWithCode(server, await aBrowser(server), secret)
    }
  })
})

describe('the operator gate: REQUIRE_OPERATOR_2FA', () => {
  const site = '/api/site/anything'

  it('refuses an operator whose session has not passed the second factor', async () => {
    const server = aServer({ requireForOperators: true })
    const browser = await aBrowser(server)
    await browser.signIn()

    const response = await browser.get(site)

    expect(response.status).toBe(403)
    expect(codeOf(response)).toBe('auth.secondFactorRequired')
  })

  it('tells an account that does not operate the box that, and nothing about second factors', async () => {
    const server = aServer({ requireForOperators: true, siteRole: 'none' })
    const browser = await aBrowser(server)
    await browser.signIn()

    const response = await browser.get(site)

    expect(response.status).toBe(403)
    expect(codeOf(response)).toBe('auth.forbidden')
  })

  it('tells a caller with no session to sign in', async () => {
    const server = aServer({ requireForOperators: true })
    const browser = await aBrowser(server)

    const response = await browser.get(site)

    expect(response.status).toBe(401)
  })

  it('lets an operator through once the session has passed it', async () => {
    const { server, secret } = await anEnrolledServer({ requireForOperators: true })
    const browser = await aBrowser(server)
    await signInWithCode(server, browser, secret)

    const response = await browser.get(site)

    expect(response.status).toBe(404)
    expect(codeOf(response)).toBe('route.notFound')
  })

  it('lets an operator through the moment they prove an enrolment in the session they enrolled in', async () => {
    const server = aServer({ requireForOperators: true })
    const browser = await aBrowser(server)
    await browser.signIn()
    const before = await browser.get(site)
    const started = await browser.post('/api/auth/2fa/enroll', { password: PASSWORD })
    const secret = decodeBase32(started.body.secret as string) ?? new Uint8Array()
    await browser.post('/api/auth/2fa/confirm', { code: server.world.codeFor(secret) })

    const after = await browser.get(site)

    expect(codeOf(before)).toBe('auth.secondFactorRequired')
    expect(codeOf(after)).toBe('route.notFound')
  })

  it('does nothing on a box that does not require it: the self-hosted default is unchanged', async () => {
    const server = aServer({ requireForOperators: false })
    const browser = await aBrowser(server)
    await browser.signIn()

    const response = await browser.get(site)

    expect(codeOf(response)).toBe('route.notFound')
  })

  it('says in /api/auth/me what the console must do next', async () => {
    const server = aServer({ requireForOperators: true })
    const browser = await aBrowser(server)
    await browser.signIn()

    const me = await browser.get('/api/auth/me')

    expect(me.body.user.secondFactor).toEqual({
      available: true,
      enrolled: false,
      verified: false,
      required: true,
    })
  })

  it('does not ask a non-operator for a second factor in /api/auth/me', async () => {
    const server = aServer({ requireForOperators: true, siteRole: 'none' })
    const browser = await aBrowser(server)
    await browser.signIn()

    const me = await browser.get('/api/auth/me')

    expect(me.body.user.secondFactor.required).toBe(false)
  })
})

describe('enrolment', () => {
  it('hands the operator a secret to scan, once, and never lets a cache keep it', async () => {
    const server = aServer()
    const browser = await aBrowser(server)
    await browser.signIn()

    const response = await browser.post('/api/auth/2fa/enroll', { password: PASSWORD })

    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//)
    expect(response.body.secret).toMatch(/^[A-Z2-7]{32}$/)
  })

  it('confirms with a code, shows ten recovery codes once, and marks the session as having passed', async () => {
    const server = aServer()
    const browser = await aBrowser(server)
    await browser.signIn()
    const started = await browser.post('/api/auth/2fa/enroll', { password: PASSWORD })
    const secret = decodeBase32(started.body.secret as string) ?? new Uint8Array()

    const response = await browser.post('/api/auth/2fa/confirm', {
      code: server.world.codeFor(secret),
    })

    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body.recoveryCodes).toHaveLength(10)
    const me = await browser.get('/api/auth/me')
    expect(me.body.user.secondFactor).toMatchObject({ enrolled: true, verified: true })
  })

  it('ends the sessions opened before it, so a thief who held the password is signed out', async () => {
    const server = aServer()
    const thief = await aBrowser(server)
    await thief.signIn()
    const owner = await aBrowser(server)
    await owner.signIn()
    server.clock.advance(1_000)
    const started = await owner.post('/api/auth/2fa/enroll', { password: PASSWORD })
    const secret = decodeBase32(started.body.secret as string) ?? new Uint8Array()

    await owner.post('/api/auth/2fa/confirm', { code: server.world.codeFor(secret) })

    expect((await thief.get('/api/auth/me')).body).toEqual({ authenticated: false })
    expect((await owner.get('/api/auth/me')).body.authenticated).toBe(true)
  })

  it('wants the password again, so a session cookie alone cannot attach a stranger’s phone', async () => {
    const server = aServer()
    const browser = await aBrowser(server)
    await browser.signIn()

    const response = await browser.post('/api/auth/2fa/enroll', { password: 'not-the-password' })

    expect(response.status).toBe(401)
    expect(codeOf(response)).toBe('auth.invalidCredentials')
    expect(server.factors.has(USER)).toBe(false)
  })

  it('is the operator’s alone', async () => {
    const server = aServer({ siteRole: 'none' })
    const browser = await aBrowser(server)
    await browser.signIn()

    const response = await browser.post('/api/auth/2fa/enroll', { password: PASSWORD })

    expect(response.status).toBe(403)
  })

  it('answers feature.unavailable on a box with no key', async () => {
    const server = aServer({ available: false })
    const browser = await aBrowser(server)
    await browser.signIn()

    const enrol = await browser.post('/api/auth/2fa/enroll', { password: PASSWORD })
    const confirm = await browser.post('/api/auth/2fa/confirm', { code: '123456' })

    expect([enrol.status, codeOf(enrol)]).toEqual([404, 'feature.unavailable'])
    expect([confirm.status, codeOf(confirm)]).toEqual([404, 'feature.unavailable'])
  })

  it('refuses a second enrolment while the first stands', async () => {
    const { server, secret } = await anEnrolledServer()
    const browser = await aBrowser(server)
    await signInWithCode(server, browser, secret)

    const response = await browser.post('/api/auth/2fa/enroll', { password: PASSWORD })

    expect(response.status).toBe(409)
    expect(codeOf(response)).toBe('auth.secondFactorAlreadyEnrolled')
  })

  it('refuses a wrong confirmation code and leaves the enrolment pending', async () => {
    const server = aServer()
    const browser = await aBrowser(server)
    await browser.signIn()
    await browser.post('/api/auth/2fa/enroll', { password: PASSWORD })

    const response = await browser.post('/api/auth/2fa/confirm', { code: '000000' })

    expect(response.status).toBe(401)
    expect(codeOf(response)).toBe('auth.invalidSecondFactor')
    expect((await browser.get('/api/auth/me')).body.user.secondFactor.enrolled).toBe(false)
  })

  it('refuses a request with no session at all', async () => {
    const server = aServer()
    const browser = await aBrowser(server)

    const enrol = await browser.post('/api/auth/2fa/enroll', { password: PASSWORD })
    const confirm = await browser.post('/api/auth/2fa/confirm', { code: '123456' })

    expect([enrol.status, confirm.status]).toEqual([401, 401])
  })
})

describe('step-up', () => {
  const signedInEnrolled = async (options: ServerOptions = {}) => {
    const setup = await anEnrolledServer(options)
    const browser = await aBrowser(setup.server)
    await signInWithCode(setup.server, browser, setup.secret)
    return { ...setup, browser }
  }

  it('keeps recovery codes behind a fresh step-up', async () => {
    const { browser } = await signedInEnrolled()

    const response = await browser.post('/api/auth/2fa/recovery-codes')

    expect(response.status).toBe(403)
    expect(codeOf(response)).toBe('auth.stepUpRequired')
  })

  it('opens them for five minutes after the password and a fresh code, and then closes them again', async () => {
    const { server, secret, browser } = await signedInEnrolled()

    const stepped = await browser.post('/api/auth/step-up', {
      password: PASSWORD,
      code: server.world.codeFor(secret),
    })
    const inTime = await browser.post('/api/auth/2fa/recovery-codes')
    server.clock.advance(FIVE_MINUTES + 1)
    const late = await browser.post('/api/auth/2fa/recovery-codes')

    expect(stepped.status).toBe(204)
    expect(inTime.status).toBe(200)
    expect(inTime.body.recoveryCodes).toHaveLength(10)
    expect(inTime.headers['cache-control']).toBe('no-store')
    expect(codeOf(late)).toBe('auth.stepUpRequired')
  })

  it('stamps nothing when the code is wrong or the password is', async () => {
    const { server, secret, browser } = await signedInEnrolled()

    const wrongCode = await browser.post('/api/auth/step-up', {
      password: PASSWORD,
      code: '000000',
    })
    const wrongPassword = await browser.post('/api/auth/step-up', {
      password: 'not-the-password',
      code: server.world.codeFor(secret),
    })
    const passwordAlone = await browser.post('/api/auth/step-up', { password: PASSWORD })
    const after = await browser.post('/api/auth/2fa/recovery-codes')

    expect(codeOf(wrongCode)).toBe('auth.invalidSecondFactor')
    expect(codeOf(wrongPassword)).toBe('auth.invalidCredentials')
    expect(codeOf(passwordAlone)).toBe('auth.invalidSecondFactor')
    expect(codeOf(after)).toBe('auth.stepUpRequired')
  })

  it('accepts a recovery code in place of the app’s code', async () => {
    const { recoveryCodes, browser } = await signedInEnrolled()

    const stepped = await browser.post('/api/auth/step-up', {
      password: PASSWORD,
      recoveryCode: recoveryCodes[0] ?? '',
    })

    expect(stepped.status).toBe(204)
  })

  it('does not let the code that signed in be used to step up', async () => {
    const setup = await anEnrolledServer()
    const browser = await aBrowser(setup.server)
    await browser.signIn()
    const code = setup.server.world.codeFor(setup.secret)
    await browser.post('/api/auth/login/2fa', { code })

    const stepped = await browser.post('/api/auth/step-up', { password: PASSWORD, code })

    expect(codeOf(stepped)).toBe('auth.invalidSecondFactor')
  })

  it('asks an account with no authenticator for the password alone', async () => {
    const server = aServer()
    const browser = await aBrowser(server)
    await browser.signIn()

    const stepped = await browser.post('/api/auth/step-up', { password: PASSWORD })

    expect(stepped.status).toBe(204)
  })

  it('refuses a caller with no session', async () => {
    const server = aServer()
    const browser = await aBrowser(server)

    const response = await browser.post('/api/auth/step-up', { password: PASSWORD })

    expect(response.status).toBe(401)
  })

  it('is dropped by a change of password, which keeps the second factor', async () => {
    const { server, secret, browser } = await signedInEnrolled({ requireForOperators: true })
    await browser.post('/api/auth/step-up', {
      password: PASSWORD,
      code: server.world.codeFor(secret),
    })
    expect((await browser.post('/api/auth/2fa/recovery-codes')).status).toBe(200)

    await browser.post('/api/auth/password', {
      currentPassword: PASSWORD,
      newPassword: 'un-autre-mot-de-passe-solide',
    })

    const afterStepUp = await browser.post('/api/auth/2fa/recovery-codes')
    const afterGate = await browser.get('/api/site/anything')
    expect(codeOf(afterStepUp)).toBe('auth.stepUpRequired')
    expect(codeOf(afterGate)).toBe('route.notFound')
  })

  it('removes the authenticator, ends every other session, and closes /api/site until the next enrolment', async () => {
    const { server, secret, browser } = await signedInEnrolled({ requireForOperators: true })
    const other = await aBrowser(server)
    await signInWithCode(server, other, secret)
    server.clock.advance(1_000)
    await browser.post('/api/auth/step-up', {
      password: PASSWORD,
      code: server.world.codeFor(secret),
    })

    const removed = await browser.post('/api/auth/2fa/disable')

    expect(removed.status).toBe(204)
    expect(server.factors.has(USER)).toBe(false)
    expect((await other.get('/api/auth/me')).body).toEqual({ authenticated: false })
    const me = await browser.get('/api/auth/me')
    expect(me.body.user.secondFactor).toMatchObject({ enrolled: false, verified: false })
    expect(codeOf(await browser.get('/api/site/anything'))).toBe('auth.secondFactorRequired')
  })

  it('wants the step-up before it removes anything', async () => {
    const { server, browser } = await signedInEnrolled()

    const response = await browser.post('/api/auth/2fa/disable')

    expect(codeOf(response)).toBe('auth.stepUpRequired')
    expect(server.factors.has(USER)).toBe(true)
  })

  it('answers an anonymous caller 401, not a request to step up', async () => {
    const server = aServer()
    const browser = await aBrowser(server)

    const recovery = await browser.post('/api/auth/2fa/recovery-codes')
    const disable = await browser.post('/api/auth/2fa/disable')

    expect([recovery.status, disable.status]).toEqual([401, 401])
  })
})
