import { describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import { aUser } from '../../testing/builders'
import { AN_ID_THE_LOG_REFUSES, USER, aSecondFactorWorld } from '../../testing/secondFactorWorld'
import { makeDisableSecondFactor } from './disableSecondFactor'

const disableFor = (world: ReturnType<typeof aSecondFactorWorld>) =>
  makeDisableSecondFactor({
    users: world.users,
    factors: world.factors,
    audit: world.audit,
    clock: world.clock,
  })

describe('disableSecondFactor', () => {
  it('removes the factor and every recovery code, spent or not', async () => {
    const world = aSecondFactorWorld()
    const { recoveryCodes } = await world.enrolled()
    await world.verifySecondFactor({
      userId: USER,
      proof: { recoveryCode: recoveryCodes[0] ?? '' },
    })

    const result = await disableFor(world)({ userId: USER })

    expect(result.ok).toBe(true)
    expect(world.factors.has(USER)).toBe(false)
    expect(world.factors.digestsOf(USER)).toEqual([])
  })

  it('ends every session of the account, so what a session proved is not what is now true', async () => {
    const world = aSecondFactorWorld()
    await world.enrolled()
    world.clock.advance(5_000)

    await disableFor(world)({ userId: USER })

    expect((await world.users.findById(USER))?.credentialsChangedAt).toEqual(world.clock.now())
  })

  it('writes the removal to the audit log', async () => {
    const world = aSecondFactorWorld()
    await world.enrolled()

    await disableFor(world)({ userId: USER })

    const row = world.audit.all().find((entry) => entry.action === 'account.secondFactorDisabled')
    expect(row).toMatchObject({
      actor: { kind: 'operator', userId: USER },
      subject: { type: 'account', id: USER },
      details: {},
    })
  })

  it('names a demoted account a member in the log', async () => {
    const world = aSecondFactorWorld()
    await world.enrolled()
    await world.users.save(aUser({ id: 'user-1', siteRole: 'none' }))

    await disableFor(world)({ userId: USER })

    const row = world.audit.all().find((entry) => entry.action === 'account.secondFactorDisabled')
    expect(row?.actor.kind).toBe('member')
  })

  it('writes the line before it removes anything', async () => {
    const world = aSecondFactorWorld()
    await world.enrolled()
    let presentWhenRecorded: boolean | undefined
    const original = world.audit.record.bind(world.audit)
    world.audit.record = async (entry) => {
      presentWhenRecorded = world.factors.has(USER)
      await original(entry)
    }

    await disableFor(world)({ userId: USER })

    expect(presentWhenRecorded).toBe(true)
  })

  it('removes nothing when the log refuses the line', async () => {
    const world = aSecondFactorWorld()
    await world.enrolled()
    world.audit.record = async () => Promise.reject(new Error('the log is down'))

    await expect(disableFor(world)({ userId: USER })).rejects.toThrow('the log is down')

    expect(world.factors.has(USER)).toBe(true)
  })

  it('is idempotent: an account with no factor changes nothing and writes no line', async () => {
    const world = aSecondFactorWorld()

    const result = await disableFor(world)({ userId: USER })

    expect(result.ok).toBe(true)
    expect(world.audit.all()).toEqual([])
    expect((await world.users.findById(USER))?.credentialsChangedAt).toBeNull()
  })

  it('answers user.notFound when the account was deleted under the session', async () => {
    const world = aSecondFactorWorld()

    const result = await disableFor(world)({ userId: asUserId('nobody') })

    expect(!result.ok && result.error.code).toBe('user.notFound')
  })

  it('can be followed by a new enrolment', async () => {
    const world = aSecondFactorWorld()
    await world.enrolled()
    await disableFor(world)({ userId: USER })

    const again = await world.enrollTotp({ userId: USER, password: 'un-mot-de-passe-solide' })

    expect(again.ok).toBe(true)
  })

  it('removes nothing when the log would refuse the entry', async () => {
    const world = aSecondFactorWorld()
    await world.factors.beginEnrolment(AN_ID_THE_LOG_REFUSES, 'aXY.dGFn.Y3Q', 1, world.clock.now())
    await world.factors.confirmEnrolment(
      AN_ID_THE_LOG_REFUSES,
      'aXY.dGFn.Y3Q',
      1,
      world.clock.now(),
      [],
    )

    const result = await disableFor(world)({ userId: AN_ID_THE_LOG_REFUSES })

    expect(!result.ok && result.error.code).toBe('audit.subjectIdInvalid')
    expect(world.factors.has(AN_ID_THE_LOG_REFUSES)).toBe(true)
  })
})
