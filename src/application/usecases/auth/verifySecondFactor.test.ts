import { describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import { canonicalRecoveryCode } from '../../../domain/users/recoveryCode'
import { totpStepAt } from '../../../domain/users/totp'
import { aUser } from '../../testing/builders'
import { FakeMfaVault } from '../../testing/fakeMfaVault'
import { USER, aSecondFactorWorld } from '../../testing/secondFactorWorld'
import { makeVerifySecondFactor } from './verifySecondFactor'

const signedIn = async () => {
  const world = aSecondFactorWorld()
  const enrolment = await world.enrolled()
  return { world, ...enrolment }
}

describe('verifySecondFactor: a code from the app', () => {
  it('accepts the code of the current step and spends that step', async () => {
    const { world, secret } = await signedIn()
    const code = world.codeFor(secret)

    const result = await world.verifySecondFactor({ userId: USER, proof: { code } })

    expect(result).toEqual({ ok: true, value: { method: 'totp', recoveryCodesRemaining: null } })
    expect(await world.factors.find(USER)).toMatchObject({
      lastUsedStep: totpStepAt(world.clock.now()),
    })
  })

  it('refuses the same code a second time: a code already used in its step is a replay', async () => {
    const { world, secret } = await signedIn()
    const code = world.codeFor(secret)
    await world.verifySecondFactor({ userId: USER, proof: { code } })

    const replay = await world.verifySecondFactor({ userId: USER, proof: { code } })

    expect(!replay.ok && replay.error.code).toBe('auth.invalidSecondFactor')
  })

  it('refuses the same code for as long as its step is still inside the window', async () => {
    const { world, secret } = await signedIn()
    const code = world.codeFor(secret)
    await world.verifySecondFactor({ userId: USER, proof: { code } })

    // Thirty seconds on, the step is one behind the clock but still acceptable by time alone.
    world.clock.advance(30_000)
    const replay = await world.verifySecondFactor({ userId: USER, proof: { code } })

    expect(!replay.ok && replay.error.code).toBe('auth.invalidSecondFactor')
  })

  it('refuses an earlier step once a later one was used', async () => {
    const { world, secret } = await signedIn()
    await world.verifySecondFactor({ userId: USER, proof: { code: world.codeFor(secret, 1) } })

    const earlier = await world.verifySecondFactor({
      userId: USER,
      proof: { code: world.codeFor(secret, 0) },
    })

    expect(!earlier.ok && earlier.error.code).toBe('auth.invalidSecondFactor')
  })

  it('accepts a fresh code on the next step', async () => {
    const { world, secret } = await signedIn()
    await world.verifySecondFactor({ userId: USER, proof: { code: world.codeFor(secret) } })

    world.clock.advance(30_000)
    const next = await world.verifySecondFactor({
      userId: USER,
      proof: { code: world.codeFor(secret) },
    })

    expect(next.ok).toBe(true)
  })

  it('lets only one of two simultaneous requests carrying one code through', async () => {
    const { world, secret } = await signedIn()
    const code = world.codeFor(secret)

    const outcomes = await Promise.all([
      world.verifySecondFactor({ userId: USER, proof: { code } }),
      world.verifySecondFactor({ userId: USER, proof: { code } }),
    ])

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1)
  })

  it('refuses a code two steps away, and one that is plainly wrong, the same way', async () => {
    const { world, secret } = await signedIn()

    for (const code of [world.codeFor(secret, 2), world.codeFor(secret, -2), '000000']) {
      const result = await world.verifySecondFactor({ userId: USER, proof: { code } })
      expect(!result.ok && result.error.code).toBe('auth.invalidSecondFactor')
    }
  })

  it('refuses text that is not six digits with the same answer, so shape is not an oracle', async () => {
    const { world } = await signedIn()

    const result = await world.verifySecondFactor({ userId: USER, proof: { code: 'abcdef' } })

    expect(!result.ok && result.error.code).toBe('auth.invalidSecondFactor')
  })

  it('refuses a code made from another account’s secret', async () => {
    const { world } = await signedIn()
    const stranger = new Uint8Array(20).fill(9)

    const result = await world.verifySecondFactor({
      userId: USER,
      proof: { code: world.codeFor(stranger) },
    })

    expect(!result.ok && result.error.code).toBe('auth.invalidSecondFactor')
  })

  it('says the box cannot check, and logs without the secret, when the stored secret will not open', async () => {
    const { world, secret } = await signedIn()
    const verify = makeVerifySecondFactor({
      users: world.users,
      factors: world.factors,
      vault: new FakeMfaVault('another-key'),
      engine: world.engine,
      secrets: world.secrets,
      audit: world.audit,
      clock: world.clock,
      logger: world.logger,
    })

    const result = await verify({ userId: USER, proof: { code: world.codeFor(secret) } })

    expect(!result.ok && result.error.code).toBe('auth.secondFactorUnavailable')
    expect(world.logger.lines).toEqual([
      {
        level: 'error',
        message: 'a stored second factor could not be opened with the configured key',
      },
    ])
  })

  it('says the box cannot check when it holds no key at all', async () => {
    const { world, secret } = await signedIn()
    const verify = makeVerifySecondFactor({
      users: world.users,
      factors: world.factors,
      vault: null,
      engine: world.engine,
      secrets: world.secrets,
      audit: world.audit,
      clock: world.clock,
      logger: world.logger,
    })

    const result = await verify({ userId: USER, proof: { code: world.codeFor(secret) } })

    expect(!result.ok && result.error.code).toBe('auth.secondFactorUnavailable')
  })
})

describe('verifySecondFactor: a recovery code', () => {
  it('accepts a code that was shown at enrolment, in whatever case and spacing it is typed', async () => {
    const { world, recoveryCodes } = await signedIn()
    const typed = (recoveryCodes[0] ?? '').toLowerCase().replaceAll('-', ' ')

    const result = await world.verifySecondFactor({
      userId: USER,
      proof: { recoveryCode: typed },
    })

    expect(result).toEqual({
      ok: true,
      value: { method: 'recoveryCode', recoveryCodesRemaining: 9 },
    })
  })

  it('accepts a code only once: the second use is refused', async () => {
    const { world, recoveryCodes } = await signedIn()
    const recoveryCode = recoveryCodes[3] ?? ''
    await world.verifySecondFactor({ userId: USER, proof: { recoveryCode } })

    const again = await world.verifySecondFactor({ userId: USER, proof: { recoveryCode } })

    expect(!again.ok && again.error.code).toBe('auth.invalidSecondFactor')
    expect(await world.factors.unusedRecoveryDigests(USER)).toHaveLength(9)
  })

  it('counts down as codes are spent', async () => {
    const { world, recoveryCodes } = await signedIn()

    const remaining: (number | null)[] = []
    for (const recoveryCode of recoveryCodes.slice(0, 3)) {
      const result = await world.verifySecondFactor({ userId: USER, proof: { recoveryCode } })
      remaining.push(result.ok ? result.value.recoveryCodesRemaining : null)
    }

    expect(remaining).toEqual([9, 8, 7])
  })

  it('lets only one of two simultaneous requests carrying one code through', async () => {
    const { world, recoveryCodes } = await signedIn()
    const recoveryCode = recoveryCodes[0] ?? ''

    const outcomes = await Promise.all([
      world.verifySecondFactor({ userId: USER, proof: { recoveryCode } }),
      world.verifySecondFactor({ userId: USER, proof: { recoveryCode } }),
    ])

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1)
  })

  it('refuses a code it never issued, and text that is not a code, the same way', async () => {
    const { world } = await signedIn()

    for (const recoveryCode of ['AAAA-AAAA-AAAA-AAAA', 'short', '']) {
      const result = await world.verifySecondFactor({ userId: USER, proof: { recoveryCode } })
      expect(!result.ok && result.error.code).toBe('auth.invalidSecondFactor')
    }
    expect(await world.factors.unusedRecoveryDigests(USER)).toHaveLength(10)
  })

  it('records the use in the audit log with the number left, and not the code', async () => {
    const { world, recoveryCodes } = await signedIn()
    const recoveryCode = recoveryCodes[0] ?? ''

    await world.verifySecondFactor({ userId: USER, proof: { recoveryCode } })

    const used = world.audit.all().filter((row) => row.action === 'account.recoveryCodeUsed')
    expect(used).toEqual([
      {
        seq: expect.any(Number),
        at: world.clock.now(),
        actor: { kind: 'operator', userId: USER, label: null },
        action: 'account.recoveryCodeUsed',
        subject: { type: 'account', id: USER },
        clientId: null,
        details: { remaining: 9 },
      },
    ])
    expect(JSON.stringify(world.audit.all())).not.toContain(canonicalRecoveryCode(recoveryCode))
  })

  it('writes no line for a code that was refused', async () => {
    const { world } = await signedIn()
    const before = world.audit.all().length

    await world.verifySecondFactor({
      userId: USER,
      proof: { recoveryCode: 'AAAA-AAAA-AAAA-AAAA' },
    })

    expect(world.audit.all()).toHaveLength(before)
  })

  it('names a demoted account a member in the log, not an operator', async () => {
    const { world, recoveryCodes } = await signedIn()
    await world.users.save(aUser({ id: 'user-1', siteRole: 'none' }))

    await world.verifySecondFactor({
      userId: USER,
      proof: { recoveryCode: recoveryCodes[0] ?? '' },
    })

    const used = world.audit.all().find((row) => row.action === 'account.recoveryCodeUsed')
    expect(used?.actor.kind).toBe('member')
  })

  it('still works on a box whose key is gone, which is what it is for', async () => {
    const { world, recoveryCodes } = await signedIn()
    const verify = makeVerifySecondFactor({
      users: world.users,
      factors: world.factors,
      vault: null,
      engine: world.engine,
      secrets: world.secrets,
      audit: world.audit,
      clock: world.clock,
      logger: world.logger,
    })

    const result = await verify({ userId: USER, proof: { recoveryCode: recoveryCodes[0] ?? '' } })

    expect(result.ok).toBe(true)
  })

  it('fails closed when the log refuses the line: the code is spent and the sign-in is not given', async () => {
    const { world, recoveryCodes } = await signedIn()
    // An audit log that is down.
    const verify = makeVerifySecondFactor({
      users: world.users,
      factors: world.factors,
      vault: world.vault,
      engine: world.engine,
      secrets: world.secrets,
      audit: { record: async () => Promise.reject(new Error('the log is down')) },
      clock: world.clock,
      logger: world.logger,
    })

    await expect(
      verify({ userId: USER, proof: { recoveryCode: recoveryCodes[0] ?? '' } }),
    ).rejects.toThrow('the log is down')
    expect(await world.factors.unusedRecoveryDigests(USER)).toHaveLength(9)
  })
})

describe('verifySecondFactor: whose sign-in it is', () => {
  it('is over for an account that no longer exists', async () => {
    const { world, secret } = await signedIn()
    await world.users.delete(USER)

    const result = await world.verifySecondFactor({
      userId: USER,
      proof: { code: world.codeFor(secret) },
    })

    expect(!result.ok && result.error.code).toBe('auth.secondFactorExpired')
  })

  it('is over for an account somebody switched off in between', async () => {
    const { world, secret } = await signedIn()
    const user = await world.users.findById(USER)
    await world.users.save(user?.disable(world.clock.now()) ?? aUser())

    const result = await world.verifySecondFactor({
      userId: USER,
      proof: { code: world.codeFor(secret) },
    })

    expect(!result.ok && result.error.code).toBe('auth.secondFactorExpired')
  })

  it('is over when the credentials changed after the password was verified', async () => {
    const { world, secret } = await signedIn()
    const passwordVerifiedAt = world.clock.now()
    world.clock.advance(1_000)
    const user = await world.users.findById(USER)
    await world.users.save(user?.revokeSessionsBefore(world.clock.now()) ?? aUser())

    const result = await world.verifySecondFactor({
      userId: USER,
      proof: { code: world.codeFor(secret) },
      passwordVerifiedAt,
    })

    expect(!result.ok && result.error.code).toBe('auth.secondFactorExpired')
  })

  it('stands when the credentials changed before the password was verified, or at the same instant', async () => {
    const { world, secret } = await signedIn()
    const user = await world.users.findById(USER)
    await world.users.save(user?.revokeSessionsBefore(world.clock.now()) ?? aUser())

    const result = await world.verifySecondFactor({
      userId: USER,
      proof: { code: world.codeFor(secret) },
      passwordVerifiedAt: world.clock.now(),
    })

    expect(result.ok).toBe(true)
  })

  it('is over for an account with no factor, or one never confirmed', async () => {
    const world = aSecondFactorWorld()
    const none = await world.verifySecondFactor({ userId: USER, proof: { code: '123456' } })
    await world.enrollTotp({ userId: USER, password: 'un-mot-de-passe-solide' })
    const pending = await world.verifySecondFactor({ userId: USER, proof: { code: '123456' } })

    expect(!none.ok && none.error.code).toBe('auth.secondFactorExpired')
    expect(!pending.ok && pending.error.code).toBe('auth.secondFactorExpired')
  })

  it('judges only the account it was asked about', async () => {
    const { world, secret } = await signedIn()

    const result = await world.verifySecondFactor({
      userId: asUserId('someone-else'),
      proof: { code: world.codeFor(secret) },
    })

    expect(!result.ok && result.error.code).toBe('auth.secondFactorExpired')
  })
})
