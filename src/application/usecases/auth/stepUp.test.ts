import { describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import { PASSWORD, USER, aSecondFactorWorld } from '../../testing/secondFactorWorld'
import { makeStepUp } from './stepUp'

const stepUpFor = (world: ReturnType<typeof aSecondFactorWorld>) =>
  makeStepUp({
    users: world.users,
    factors: world.factors,
    hasher: world.hasher,
    verifySecondFactor: world.verifySecondFactor,
  })

describe('stepUp', () => {
  it('confirms an account with a factor on its password and a fresh code', async () => {
    const world = aSecondFactorWorld()
    const { secret } = await world.enrolled()

    const result = await stepUpFor(world)({
      userId: USER,
      password: PASSWORD,
      proof: { code: world.codeFor(secret) },
    })

    expect(result).toEqual({ ok: true, value: { secondFactorUsed: true } })
  })

  it('wants a code of its own: the code that signed in cannot be reused to step up', async () => {
    const world = aSecondFactorWorld()
    const { secret } = await world.enrolled()
    const code = world.codeFor(secret)
    await world.verifySecondFactor({ userId: USER, proof: { code } })

    const result = await stepUpFor(world)({ userId: USER, password: PASSWORD, proof: { code } })

    expect(!result.ok && result.error.code).toBe('auth.invalidSecondFactor')
  })

  it('accepts a recovery code in place of the code, and spends it', async () => {
    const world = aSecondFactorWorld()
    const { recoveryCodes } = await world.enrolled()

    const result = await stepUpFor(world)({
      userId: USER,
      password: PASSWORD,
      proof: { recoveryCode: recoveryCodes[0] ?? '' },
    })

    expect(result).toEqual({ ok: true, value: { secondFactorUsed: true } })
    expect(await world.factors.unusedRecoveryDigests(USER)).toHaveLength(9)
  })

  it('refuses a wrong password, and does not spend the code it came with', async () => {
    const world = aSecondFactorWorld()
    const { secret } = await world.enrolled()

    const result = await stepUpFor(world)({
      userId: USER,
      password: 'not-the-password',
      proof: { code: world.codeFor(secret) },
    })

    expect(!result.ok && result.error.code).toBe('auth.invalidCredentials')
    const retry = await stepUpFor(world)({
      userId: USER,
      password: PASSWORD,
      proof: { code: world.codeFor(secret) },
    })
    expect(retry.ok).toBe(true)
  })

  it('refuses a right password with a wrong code', async () => {
    const world = aSecondFactorWorld()
    await world.enrolled()

    const result = await stepUpFor(world)({
      userId: USER,
      password: PASSWORD,
      proof: { code: '000000' },
    })

    expect(!result.ok && result.error.code).toBe('auth.invalidSecondFactor')
  })

  it('refuses the password alone when the account has a factor', async () => {
    const world = aSecondFactorWorld()
    await world.enrolled()

    const result = await stepUpFor(world)({ userId: USER, password: PASSWORD })

    expect(!result.ok && result.error.code).toBe('auth.invalidSecondFactor')
  })

  it('asks the password alone of an account with no factor: a box that does not require one is not locked out', async () => {
    const world = aSecondFactorWorld()

    const result = await stepUpFor(world)({ userId: USER, password: PASSWORD })

    expect(result).toEqual({ ok: true, value: { secondFactorUsed: false } })
  })

  it('asks the password alone of an account whose enrolment was never confirmed', async () => {
    const world = aSecondFactorWorld()
    await world.enrollTotp({ userId: USER, password: PASSWORD })

    const result = await stepUpFor(world)({ userId: USER, password: PASSWORD })

    expect(result).toEqual({ ok: true, value: { secondFactorUsed: false } })
  })

  it('asks a session whose account is gone or switched off to sign in again', async () => {
    const world = aSecondFactorWorld()
    const gone = await stepUpFor(world)({ userId: asUserId('nobody'), password: PASSWORD })
    const user = await world.users.findById(USER)
    if (user !== null) await world.users.save(user.disable(world.clock.now()))
    const off = await stepUpFor(world)({ userId: USER, password: PASSWORD })

    expect(!gone.ok && gone.error.code).toBe('auth.required')
    expect(!off.ok && off.error.code).toBe('auth.required')
  })
})
