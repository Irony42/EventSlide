import { describe, expect, it } from 'vitest'
import { decodeBase32 } from '../../../domain/users/base32'
import { canonicalRecoveryCode } from '../../../domain/users/recoveryCode'
import { totpStepAt } from '../../../domain/users/totp'
import { FakeMfaVault } from '../../testing/fakeMfaVault'
import { PASSWORD, USER, aSecondFactorWorld } from '../../testing/secondFactorWorld'

const begin = async (world: ReturnType<typeof aSecondFactorWorld>): Promise<Uint8Array> => {
  const started = await world.enrollTotp({ userId: USER, password: PASSWORD })
  const secret = started.ok ? decodeBase32(started.value.secret) : null
  if (secret === null) throw new Error('the enrolment did not start')
  return secret
}

describe('confirmTotpEnrollment', () => {
  it('confirms the factor when the code is right, and shows ten recovery codes once', async () => {
    const world = aSecondFactorWorld()
    const secret = await begin(world)

    const result = await world.confirmTotpEnrollment({ userId: USER, code: world.codeFor(secret) })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.recoveryCodes).toHaveLength(10)
    expect(new Set(result.value.recoveryCodes).size).toBe(10)
    for (const code of result.value.recoveryCodes) {
      expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/)
    }
    expect(await world.factors.find(USER)).toMatchObject({ confirmedAt: world.clock.now() })
  })

  it('stores the recovery codes as digests of their canonical form, never as codes', async () => {
    const world = aSecondFactorWorld()
    const secret = await begin(world)

    const result = await world.confirmTotpEnrollment({ userId: USER, code: world.codeFor(secret) })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const stored = world.factors.digestsOf(USER)
    expect([...stored].sort()).toEqual(
      result.value.recoveryCodes
        .map((code) => world.secrets.digestOf(canonicalRecoveryCode(code) ?? ''))
        .sort(),
    )
    for (const code of result.value.recoveryCodes) {
      expect(stored.join('')).not.toContain(code.replaceAll('-', ''))
    }
  })

  it('spends the step that proved the enrolment, so the same code cannot sign in a moment later', async () => {
    const world = aSecondFactorWorld()
    const secret = await begin(world)
    const code = world.codeFor(secret)

    await world.confirmTotpEnrollment({ userId: USER, code })

    expect(await world.factors.find(USER)).toMatchObject({
      lastUsedStep: totpStepAt(world.clock.now()),
    })
    const replay = await world.verifySecondFactor({ userId: USER, proof: { code } })
    expect(!replay.ok && replay.error.code).toBe('auth.invalidSecondFactor')
  })

  it('accepts the code of the step before and after, for a phone whose clock is out', async () => {
    const world = aSecondFactorWorld()
    const secret = await begin(world)

    const result = await world.confirmTotpEnrollment({
      userId: USER,
      code: world.codeFor(secret, 1),
    })

    expect(result.ok).toBe(true)
    expect(await world.factors.find(USER)).toMatchObject({
      lastUsedStep: totpStepAt(world.clock.now()) + 1,
    })
  })

  it('refuses a code two steps away, and leaves the enrolment pending', async () => {
    const world = aSecondFactorWorld()
    const secret = await begin(world)

    const result = await world.confirmTotpEnrollment({
      userId: USER,
      code: world.codeFor(secret, 2),
    })

    expect(!result.ok && result.error.code).toBe('auth.invalidSecondFactor')
    expect(await world.factors.find(USER)).toMatchObject({ confirmedAt: null })
    expect(world.audit.all()).toEqual([])
  })

  it.each(['', '12345', 'abcdef', '1234567'])(
    'refuses %j before it costs an HMAC',
    async (code) => {
      const world = aSecondFactorWorld()
      await begin(world)

      const result = await world.confirmTotpEnrollment({ userId: USER, code })

      expect(!result.ok && result.error.code).toBe('auth.totpCodeInvalid')
    },
  )

  it('ends every session issued before it, so a thief who held the password is signed out', async () => {
    const world = aSecondFactorWorld()
    const secret = await begin(world)

    await world.confirmTotpEnrollment({ userId: USER, code: world.codeFor(secret) })

    expect((await world.users.findById(USER))?.credentialsChangedAt).toEqual(world.clock.now())
  })

  it('writes the enrolment to the audit log, and nothing secret with it', async () => {
    const world = aSecondFactorWorld()
    const secret = await begin(world)

    const result = await world.confirmTotpEnrollment({ userId: USER, code: world.codeFor(secret) })

    expect(world.audit.all()).toEqual([
      {
        seq: 1,
        at: world.clock.now(),
        actor: { kind: 'operator', userId: USER, label: null },
        action: 'account.secondFactorEnrolled',
        subject: { type: 'account', id: USER },
        clientId: null,
        details: {},
      },
    ])
    const log = JSON.stringify(world.audit.all())
    expect(log).not.toContain(world.codeFor(secret))
    expect(result.ok && result.value.recoveryCodes.some((code) => log.includes(code))).toBe(false)
  })

  it('refuses when nothing was begun', async () => {
    const world = aSecondFactorWorld()

    const result = await world.confirmTotpEnrollment({ userId: USER, code: '123456' })

    expect(!result.ok && result.error.code).toBe('auth.noEnrolmentInProgress')
  })

  it('refuses a second confirmation of a factor that is already confirmed', async () => {
    const world = aSecondFactorWorld()
    const { secret } = await world.enrolled()

    const result = await world.confirmTotpEnrollment({ userId: USER, code: world.codeFor(secret) })

    expect(!result.ok && result.error.code).toBe('auth.noEnrolmentInProgress')
  })

  it('answers feature.unavailable on a box with no key', async () => {
    const world = aSecondFactorWorld({ withVault: false })

    const result = await world.confirmTotpEnrollment({ userId: USER, code: '123456' })

    expect(!result.ok && result.error.code).toBe('feature.unavailable')
  })

  it('says the box cannot check, and logs without the secret, when the stored secret will not open', async () => {
    const world = aSecondFactorWorld()
    const secret = await begin(world)
    // Sealed under another key, as after a key was replaced.
    const stranger = new FakeMfaVault('another-key').seal(new Uint8Array([1, 2, 3]))
    await world.factors.beginEnrolment(
      USER,
      stranger.sealed,
      stranger.keyVersion,
      world.clock.now(),
    )

    const result = await world.confirmTotpEnrollment({ userId: USER, code: world.codeFor(secret) })

    expect(!result.ok && result.error.code).toBe('auth.secondFactorUnavailable')
    expect(world.captured.lines).toEqual([
      {
        level: 'error',
        message: 'a pending second factor could not be opened with the configured key',
      },
    ])
  })

  it('writes the audit line before it confirms the factor', async () => {
    const world = aSecondFactorWorld()
    const secret = await begin(world)
    const audit = world.audit
    const original = audit.record.bind(audit)
    let confirmedAtRecord: Date | null | undefined
    audit.record = async (entry) => {
      confirmedAtRecord = (await world.factors.find(USER))?.confirmedAt
      await original(entry)
    }

    await world.confirmTotpEnrollment({ userId: USER, code: world.codeFor(secret) })

    expect(confirmedAtRecord).toBeNull()
  })

  it('reports a lost race as no enrolment in progress, and ends no session', async () => {
    const world = aSecondFactorWorld()
    const secret = await begin(world)
    world.factors.confirmEnrolment = async () => false

    const result = await world.confirmTotpEnrollment({ userId: USER, code: world.codeFor(secret) })

    expect(!result.ok && result.error.code).toBe('auth.noEnrolmentInProgress')
    expect((await world.users.findById(USER))?.credentialsChangedAt).toBeNull()
  })

  it('answers user.notFound when the account was deleted under the session', async () => {
    const world = aSecondFactorWorld()
    const secret = await begin(world)
    await world.users.delete(USER)

    const result = await world.confirmTotpEnrollment({ userId: USER, code: world.codeFor(secret) })

    expect(!result.ok && result.error.code).toBe('user.notFound')
  })
})
