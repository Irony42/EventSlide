import { describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import { aUser } from '../../testing/builders'
import { AN_ID_THE_LOG_REFUSES, USER, aSecondFactorWorld } from '../../testing/secondFactorWorld'
import { makeRegenerateRecoveryCodes } from './regenerateRecoveryCodes'

const regenerateFor = (world: ReturnType<typeof aSecondFactorWorld>) =>
  makeRegenerateRecoveryCodes({
    users: world.users,
    factors: world.factors,
    secrets: world.secrets,
    ids: world.ids,
    audit: world.audit,
    clock: world.clock,
  })

describe('regenerateRecoveryCodes', () => {
  it('hands out ten new codes and stops the old ones working at once, spent or not', async () => {
    const world = aSecondFactorWorld()
    const { recoveryCodes: old } = await world.enrolled()
    await world.verifySecondFactor({ userId: USER, proof: { recoveryCode: old[0] ?? '' } })

    const result = await regenerateFor(world)({ userId: USER })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.recoveryCodes).toHaveLength(10)
    expect(result.value.recoveryCodes.filter((code) => old.includes(code))).toEqual([])
    for (const code of old) {
      const refused = await world.verifySecondFactor({
        userId: USER,
        proof: { recoveryCode: code },
      })
      expect(!refused.ok && refused.error.code).toBe('auth.invalidSecondFactor')
    }
    const accepted = await world.verifySecondFactor({
      userId: USER,
      proof: { recoveryCode: result.value.recoveryCodes[0] ?? '' },
    })
    expect(accepted.ok).toBe(true)
  })

  it('stores digests of the new codes, never the codes', async () => {
    const world = aSecondFactorWorld()
    await world.enrolled()

    const result = await regenerateFor(world)({ userId: USER })

    const stored = world.factors.digestsOf(USER).join('')
    expect(result.ok && result.value.recoveryCodes.some((code) => stored.includes(code))).toBe(
      false,
    )
    expect(world.factors.digestsOf(USER)).toHaveLength(10)
  })

  it('writes the regeneration to the audit log, and not a code', async () => {
    const world = aSecondFactorWorld()
    await world.enrolled()

    await regenerateFor(world)({ userId: USER })

    const rows = world.audit
      .all()
      .filter((row) => row.action === 'account.recoveryCodesRegenerated')
    expect(rows).toEqual([
      {
        seq: expect.any(Number),
        at: world.clock.now(),
        actor: { kind: 'operator', userId: USER, label: null },
        action: 'account.recoveryCodesRegenerated',
        subject: { type: 'account', id: USER },
        clientId: null,
        details: {},
      },
    ])
  })

  it('names a demoted account a member in the log', async () => {
    const world = aSecondFactorWorld()
    await world.enrolled()
    await world.users.save(aUser({ id: 'user-1', siteRole: 'none' }))

    await regenerateFor(world)({ userId: USER })

    const row = world.audit
      .all()
      .find((entry) => entry.action === 'account.recoveryCodesRegenerated')
    expect(row?.actor.kind).toBe('member')
  })

  it('refuses an account with no factor, and one whose enrolment was never confirmed', async () => {
    const world = aSecondFactorWorld()
    const none = await regenerateFor(world)({ userId: USER })
    await world.enrollTotp({ userId: USER, password: 'un-mot-de-passe-solide' })
    const pending = await regenerateFor(world)({ userId: USER })

    expect(!none.ok && none.error.code).toBe('auth.secondFactorNotEnrolled')
    expect(!pending.ok && pending.error.code).toBe('auth.secondFactorNotEnrolled')
    expect(world.audit.all()).toEqual([])
  })

  it('answers user.notFound when the account was deleted under the session', async () => {
    const world = aSecondFactorWorld()

    const result = await regenerateFor(world)({ userId: asUserId('nobody') })

    expect(!result.ok && result.error.code).toBe('user.notFound')
  })

  it('reports a factor removed while it worked as not enrolled, and keeps no code', async () => {
    const world = aSecondFactorWorld()
    await world.enrolled()
    world.factors.replaceRecoveryCodes = async () => false

    const result = await regenerateFor(world)({ userId: USER })

    expect(!result.ok && result.error.code).toBe('auth.secondFactorNotEnrolled')
  })

  it('replaces nothing when the log would refuse the entry', async () => {
    const world = aSecondFactorWorld()
    await world.factors.beginEnrolment(AN_ID_THE_LOG_REFUSES, 'aXY.dGFn.Y3Q', 1, world.clock.now())
    await world.factors.confirmEnrolment(
      AN_ID_THE_LOG_REFUSES,
      'aXY.dGFn.Y3Q',
      1,
      world.clock.now(),
      ['a'.repeat(64)],
    )

    const result = await regenerateFor(world)({ userId: AN_ID_THE_LOG_REFUSES })

    expect(!result.ok && result.error.code).toBe('audit.subjectIdInvalid')
    expect(world.factors.digestsOf(AN_ID_THE_LOG_REFUSES)).toEqual(['a'.repeat(64)])
  })
})
