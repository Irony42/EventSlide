import { describe, expect, it } from 'vitest'
import { AT } from '../../../application/testing/builders'
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
import { canonicalRecoveryCode } from '../../../domain/users/recoveryCode'
import { decodeBase32 } from '../../../domain/users/base32'
import { createAesGcmMfaVault } from '../../../infrastructure/crypto/aesGcmMfaVault'
import { nodeTotpEngine } from '../../../infrastructure/crypto/nodeTotpEngine'
import { sha256SecretTokens } from '../../../infrastructure/crypto/sha256SecretTokens'
import { createPinoLogger } from '../../../infrastructure/logging/pinoLogger'
import { CSRF_COOKIE, CSRF_HEADER } from '../middleware/csrf'
import { testHttpConfig } from './middlewareHarness'
import { captureAllOutputWhile } from './captureOutput'
import { buildServerHarness } from './serverHarness'
import { anonymousCaller, setCookies } from './signIn'

/**
 * A second factor must write no secret into any log (docs/SECURITY.md §9; roadmap G2-13 /
 * P3-15).
 *
 * What is at stake is concrete: the authenticator's secret is a permanent password, a recovery
 * code is a password until it is used, and a TOTP code is one for thirty seconds. The places
 * any of them could be written are not one place — the use cases log, the vault could throw
 * something that carries its input, the access log writes a line per request, the error handler
 * logs what it catches — so this does not read a log statement. It runs the whole journey against
 * a *real* logger, a *real, enabled* access log, the *real* engine, vault and digests, and reads
 * every byte the process wrote, on every channel it could have used (the same net
 * `logCanary.test.ts` casts over the route table, and `passwordResetLogCanary.test.ts` over a
 * reset).
 *
 * The journey plants the things a second factor handles: the sign-in address, the password, the
 * secret (as text and inside the `otpauth://` URI), the sealed text the vault stores, the key
 * itself in the two spellings an operator may have typed, every TOTP code that was typed, right
 * or wrong, and every recovery code, formatted and canonical.
 */

const INSTANCE = { service: 'eventslide', version: 'mfa-canary', instance: 'mfa-canary-box' }
const KEY = Uint8Array.from({ length: 32 }, (_, index) => (index * 7 + 3) % 256)
const SECOND_PASSWORD = 'canary-another-password-5c0a1e9d'

/**
 * Whether `secret` is written in `output`. A six-digit code is matched as a whole word: the same
 * six digits occur by chance inside a timestamp or a request id about one run in fifty, and a
 * canary that fails on chance teaches people to ignore it. A leaked code is bounded by quotes,
 * spaces or punctuation, never by more letters or digits.
 */
const appearsIn = (output: string, secret: string): boolean =>
  /^d{6}$/.test(secret)
    ? new RegExp(`(?<![0-9A-Za-z])${secret}(?![0-9A-Za-z])`).test(output)
    : output.includes(secret)

const journey = async (): Promise<readonly string[]> => {
  const logger = createPinoLogger({ level: 'trace', pretty: false, bindings: INSTANCE })
  const clock = new FakeClock(AT)
  const users = new FakeUserRepository()
  const factors = new FakeSecondFactorRepository()
  const vault = createAesGcmMfaVault({ keyMaterial: KEY })
  const world = aSecondFactorWorld({
    clock,
    users,
    factors,
    logger,
    vault,
    engine: nodeTotpEngine,
    secrets: sha256SecretTokens,
  })
  const planted: string[] = []

  const subject = buildServerHarness({
    logger,
    users,
    secondFactors: factors,
    clock,
    config: {
      siteAdmin: true,
      secondFactor: { available: true, requiredForOperators: true },
      accessLog: { enabled: true, level: 'trace', pretty: false, ...INSTANCE },
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

  const { agent, csrf } = await anonymousCaller(subject.app)
  let token = csrf
  const post = async (path: string, body: object = {}) => {
    const response = await agent.post(path).set(CSRF_HEADER, token).send(body)
    const rotated = setCookies(response.headers).find((value) =>
      value.startsWith(`${CSRF_COOKIE}=`),
    )
    if (rotated !== undefined) {
      token = decodeURIComponent(rotated.slice(CSRF_COOKIE.length + 1).split(';')[0] ?? '')
    }
    return response
  }

  // Enrol: the password, the secret, the proof, the codes.
  await post('/api/auth/login', { email: EMAIL, password: PASSWORD })
  const started = await post('/api/auth/2fa/enroll', { password: PASSWORD })
  const secretText = started.body.secret as string
  const secret = decodeBase32(secretText) ?? new Uint8Array()
  planted.push(secretText, started.body.otpauthUri as string, Buffer.from(secret).toString('hex'))
  const proof = world.codeFor(secret)
  planted.push(proof)
  const confirmed = await post('/api/auth/2fa/confirm', { code: proof })
  const codes = confirmed.body.recoveryCodes as string[]
  planted.push(...codes, ...codes.map((code) => canonicalRecoveryCode(code) ?? ''))
  const stored = await factors.find(USER)
  planted.push(stored?.sealedSecret ?? '')

  // Sign in again, wrongly and rightly, by app and by recovery code.
  await post('/api/auth/logout')
  clock.advance(30_000)
  await post('/api/auth/login', { email: EMAIL, password: PASSWORD })
  planted.push('000000')
  await post('/api/auth/login/2fa', { code: '000000' })
  await post('/api/auth/login/2fa', { recoveryCode: 'AAAA-AAAA-AAAA-AAAA' })
  const signIn = world.codeFor(secret)
  planted.push(signIn)
  await post('/api/auth/login/2fa', { code: signIn })
  await post('/api/auth/logout')
  await post('/api/auth/login', { email: EMAIL, password: PASSWORD })
  await post('/api/auth/login/2fa', { recoveryCode: codes[0] ?? '' })

  // Step up, regenerate, change the password, remove the factor.
  clock.advance(30_000)
  const stepUp = world.codeFor(secret)
  planted.push(stepUp)
  await post('/api/auth/step-up', { password: PASSWORD, code: stepUp })
  const regenerated = await post('/api/auth/2fa/recovery-codes')
  const fresh = regenerated.body.recoveryCodes as string[]
  planted.push(...fresh, ...fresh.map((code) => canonicalRecoveryCode(code) ?? ''))
  await post('/api/auth/step-up', { password: 'canary-wrong-password-5c0a1e9d', code: '123456' })
  await post('/api/auth/password', { currentPassword: PASSWORD, newPassword: SECOND_PASSWORD })
  await post('/api/auth/2fa/disable')

  // And the box that cannot open what it stored: the line that says so must not carry it.
  const stranger = createAesGcmMfaVault({ keyMaterial: new Uint8Array(32).fill(9) })
  const lost = aSecondFactorWorld({
    clock,
    users: new FakeUserRepository(),
    factors: new FakeSecondFactorRepository(),
    logger,
    vault: stranger,
    engine: nodeTotpEngine,
    secrets: sha256SecretTokens,
  })
  const foreign = stored?.sealedSecret ?? 'a.b.c'
  await lost.factors.beginEnrolment(USER, foreign, 1, clock.now())
  await lost.factors.confirmEnrolment(USER, foreign, 1, clock.now(), [])
  await lost.verifySecondFactor({ userId: USER, proof: { code: '654321' } })

  planted.push(
    EMAIL,
    PASSWORD,
    SECOND_PASSWORD,
    'canary-wrong-password-5c0a1e9d',
    Buffer.from(KEY).toString('hex'),
    Buffer.from(KEY).toString('base64'),
    Buffer.from(KEY).toString('base64url'),
    '123456',
    '654321',
    'AAAA-AAAA-AAAA-AAAA',
  )
  return planted.filter((value) => value !== '')
}

describe('the log canary: a second factor', () => {
  it('writes no secret, code, key, password or address on any channel, through enrolment, sign-in, step-up and removal', async () => {
    let planted: readonly string[] = []
    const output = await captureAllOutputWhile(async () => {
      planted = await journey()
    })

    expect(planted.length).toBeGreaterThan(20)
    expect(output.length).toBeGreaterThan(0)
    for (const secret of planted) {
      expect(
        appearsIn(output, secret),
        `the output contains ${secret.length} characters it must not`,
      ).toBe(false)
    }
  })

  it('does say, by code and without the secret, that a stored factor could not be opened', async () => {
    const output = await captureAllOutputWhile(async () => {
      await journey()
    })

    expect(output).toContain('a stored second factor could not be opened with the configured key')
  })

  it('keeps the audit log free of every secret it could have been handed', async () => {
    const clock = new FakeClock(AT)
    const world = aSecondFactorWorld({
      clock,
      vault: createAesGcmMfaVault({ keyMaterial: KEY }),
      engine: nodeTotpEngine,
      secrets: sha256SecretTokens,
    })
    const { secret, recoveryCodes } = await world.enrolled()
    await world.verifySecondFactor({
      userId: USER,
      proof: { recoveryCode: recoveryCodes[0] ?? '' },
    })
    await world.regenerateRecoveryCodes({ userId: USER })
    const log = JSON.stringify(world.audit.all())

    expect(log).toContain('account.secondFactorEnrolled')
    expect(log).toContain('account.recoveryCodeUsed')
    expect(log).toContain('account.recoveryCodesRegenerated')
    for (const planted of [
      ...recoveryCodes,
      ...recoveryCodes.map((code) => canonicalRecoveryCode(code) ?? ''),
      world.codeFor(secret),
      Buffer.from(secret).toString('hex'),
      EMAIL,
      PASSWORD,
    ]) {
      expect(log).not.toContain(planted)
    }
  })
})
