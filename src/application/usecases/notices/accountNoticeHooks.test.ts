import { describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import { AT, aUser, anAccountToken } from '../../testing/builders'
import { FakeAccountHoldings } from '../../testing/fakeAccountHoldings'
import { FakeAccountTokenRepository } from '../../testing/fakeAccountTokenRepository'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakePasswordHasher } from '../../testing/fakePasswordHasher'
import { FakeSecretTokens } from '../../testing/fakeSecretTokens'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { RecordingAccountNotice } from '../../testing/recordingAccountNotice'
import { aSecondFactorWorld, USER } from '../../testing/secondFactorWorld'
import { makeChangePassword } from '../auth/changePassword'
import { makeDisableAccount } from '../auth/disableAccount'
import { makeEnableAccount } from '../auth/enableAccount'
import { makeResetPassword } from '../auth/resetPassword'
import { makeDeleteAccount } from '../site/deleteAccount'
import { makeDeleteOwnAccount } from '../auth/deleteOwnAccount'
import { DomainError } from '../../../domain/shared/errors'
import { err, ok } from '../../../domain/shared/result'

/**
 * Which acts tell the holder by mail (spec 32, A1, A1b, A1c), seen from the use case: **after the write succeeded and
 * never before, once, with the right kind, and never for a refusal or a change that changed nothing**. What the mail
 * says is `accountChangeMail`'s; who it goes to and when it leaves is `accountNotice`'s.
 */

const HOST = asUserId('user-1')
const OPERATOR = { kind: 'operator', userId: asUserId('user-operator') } as const

describe('changePassword tells the holder', () => {
  const build = (over: { mustChangePassword?: boolean } = {}) => {
    const users = new FakeUserRepository().seed(
      aUser({ id: 'user-1', mustChangePassword: over.mustChangePassword ?? false }),
    )
    const notice = new RecordingAccountNotice()
    const change = (
      newPassword = 'une-phrase-de-passe-neuve',
      current = 'un-mot-de-passe-solide',
    ) =>
      makeChangePassword({
        users,
        hasher: new FakePasswordHasher(),
        clock: new FakeClock(AT),
        notice,
      })({ userId: HOST, currentPassword: current, newPassword })
    return { change, notice }
  }

  it('after the password changed, once, as passwordChanged', async () => {
    const { change, notice } = build()

    expect((await change()).ok).toBe(true)

    expect(notice.notified).toEqual([{ userId: HOST, kind: 'passwordChanged' }])
  })

  it('not for the forced first change: the password an invitation handed over is no security event', async () => {
    const { change, notice } = build({ mustChangePassword: true })

    expect((await change()).ok).toBe(true)

    expect(notice.notified).toEqual([])
  })

  it('not when the change is refused (wrong current password, unchanged password)', async () => {
    const { change, notice } = build()

    expect((await change('une-phrase-de-passe-neuve', 'faux')).ok).toBe(false)
    expect((await change('un-mot-de-passe-solide')).ok).toBe(false)

    expect(notice.notified).toEqual([])
  })
})

describe('resetPassword tells the holder', () => {
  const build = async (newPassword = 'une-phrase-de-passe-neuve') => {
    const users = new FakeUserRepository().seed(
      aUser({ id: 'user-1', email: 'hote@example.test', passwordHash: 'hash:ancien-mot-de-passe' }),
    )
    const tokens = new FakeAccountTokenRepository().withAccounts(HOST)
    const secrets = new FakeSecretTokens()
    const { token, digest } = secrets.mint()
    await tokens.save(anAccountToken({ id: 'tok-1', tokenDigest: digest }))
    const notice = new RecordingAccountNotice()
    const reset = (given = token) =>
      makeResetPassword({
        users,
        tokens,
        secrets,
        hasher: new FakePasswordHasher(),
        clock: new FakeClock(AT),
        notice,
      })({ token: given, newPassword })
    return { reset, notice, token }
  }

  it('after the password was reset by link, once, as passwordReset', async () => {
    const { reset, notice } = await build()

    expect((await reset()).ok).toBe(true)

    expect(notice.notified).toEqual([{ userId: HOST, kind: 'passwordReset' }])
  })

  it('not for a dead link, nor for a password the policy refuses', async () => {
    const { reset, notice } = await build()
    expect((await reset('not-a-link')).ok).toBe(false)

    const weak = await build('court')
    expect((await weak.reset()).ok).toBe(false)

    expect(notice.notified).toEqual([])
    expect(weak.notice.notified).toEqual([])
  })
})

describe('the second factor tells the holder', () => {
  it('on confirming the enrolment (totpEnabled), after the write and not on a wrong code', async () => {
    const notice = new RecordingAccountNotice()
    const world = aSecondFactorWorld({ notice })
    const started = await world.enrollTotp({ userId: USER, password: 'un-mot-de-passe-solide' })
    if (!started.ok) throw new Error('enrolment refused')

    const wrong = await world.confirmTotpEnrollment({ userId: USER, code: '000000' })
    expect(wrong.ok).toBe(false)
    expect(notice.notified).toEqual([])

    await world.enrolled()
    expect(notice.notified.map((n) => n.kind)).toEqual(['totpEnabled'])
  })

  it('on renewing the recovery codes, and not for an account with no factor', async () => {
    const notice = new RecordingAccountNotice()
    const world = aSecondFactorWorld({ notice })

    expect((await world.regenerateRecoveryCodes({ userId: USER })).ok).toBe(false)
    expect(notice.notified).toEqual([])

    await world.enrolled()
    notice.events.length = 0
    expect((await world.regenerateRecoveryCodes({ userId: USER })).ok).toBe(true)
    expect(notice.notified.slice(-1)).toEqual([{ userId: USER, kind: 'recoveryCodesRegenerated' }])
  })

  it('on removing the factor (totpDisabled), and not when there was none to remove', async () => {
    const notice = new RecordingAccountNotice()
    const world = aSecondFactorWorld({ notice })

    expect((await world.disableSecondFactor({ userId: USER })).ok).toBe(true)
    expect(notice.notified).toEqual([])

    await world.enrolled()
    const before = notice.notified.length
    expect((await world.disableSecondFactor({ userId: USER })).ok).toBe(true)
    expect(notice.notified.slice(before)).toEqual([{ userId: USER, kind: 'totpDisabled' }])
  })
})

describe('the operator switching an account off or on tells the holder', () => {
  const build = (disabled: boolean) => {
    const users = new FakeUserRepository().seed(
      aUser({
        id: 'user-1',
        email: 'moderateur@example.test',
        ...(disabled ? { disabledAt: AT } : {}),
      }),
    )
    const deps = {
      users,
      clients: new FakeClientRepository(),
      audit: new FakeAuditLog().withAccounts(asUserId('user-operator')),
      clock: new FakeClock(AT),
    }
    const notice = new RecordingAccountNotice()
    return {
      notice,
      disable: () => makeDisableAccount({ ...deps, notice })({ userId: HOST, actor: OPERATOR }),
      enable: () => makeEnableAccount({ ...deps, notice })({ userId: HOST, actor: OPERATOR }),
    }
  }

  it('disabling tells accountDisabled once, and a second disabling tells nothing more', async () => {
    const { disable, notice } = build(false)

    await disable()
    await disable()

    expect(notice.notified).toEqual([{ userId: HOST, kind: 'accountDisabled' }])
  })

  it('enabling tells accountEnabled once, and enabling an account that is on tells nothing', async () => {
    const off = build(true)
    await off.enable()
    await off.enable()
    expect(off.notice.notified).toEqual([{ userId: HOST, kind: 'accountEnabled' }])

    const on = build(false)
    await on.enable()
    expect(on.notice.notified).toEqual([])
  })

  it('tells nothing when an operator is refused', async () => {
    const users = new FakeUserRepository().seed(aUser({ id: 'user-1', siteRole: 'operator' }))
    const notice = new RecordingAccountNotice()

    const result = await makeDisableAccount({
      users,
      clients: new FakeClientRepository(),
      audit: new FakeAuditLog(),
      clock: new FakeClock(AT),
      notice,
    })({ userId: HOST, actor: OPERATOR })

    expect(result.ok).toBe(false)
    expect(notice.notified).toEqual([])
  })
})

describe('deleteAccount tells the holder (A1c)', () => {
  const build = () => {
    const users = new FakeUserRepository().seed(
      aUser({ id: 'user-1', email: 'personne@example.test' }),
    )
    const holdings = new FakeAccountHoldings()
    const notice = new RecordingAccountNotice()
    const remove = makeDeleteAccount({
      users,
      clients: new FakeClientRepository(),
      holdings,
      audit: new FakeAuditLog().withAccounts(asUserId('user-operator')),
      clock: new FakeClock(AT),
      notice,
    })
    return { remove, notice, users }
  }

  it('reads the address before the deletion and sends after it: one mail, accountDeleted', async () => {
    const { remove, notice, users } = build()

    expect((await remove({ userId: HOST, actor: OPERATOR })).ok).toBe(true)

    expect(await users.findById(HOST)).toBeNull()
    expect(notice.events).toEqual(['prepare:accountDeleted', 'send:accountDeleted'])
  })

  it('sends nothing when the deletion is refused (an operator account)', async () => {
    const users = new FakeUserRepository().seed(aUser({ id: 'user-1', siteRole: 'operator' }))
    const notice = new RecordingAccountNotice()

    const result = await makeDeleteAccount({
      users,
      clients: new FakeClientRepository(),
      holdings: new FakeAccountHoldings(),
      audit: new FakeAuditLog(),
      clock: new FakeClock(AT),
      notice,
    })({ userId: HOST, actor: OPERATOR })

    expect(result.ok).toBe(false)
    expect(notice.events).toEqual([])
  })
})

describe('deleteOwnAccount tells the holder through the one deletion (A1c)', () => {
  it('sends exactly one mail: the person erasing themselves passes the same use case as the operator', async () => {
    const users = new FakeUserRepository().seed(
      aUser({ id: 'user-1', email: 'personne@example.test' }),
    )
    const notice = new RecordingAccountNotice()
    const deleteAccount = makeDeleteAccount({
      users,
      clients: new FakeClientRepository(),
      holdings: new FakeAccountHoldings(),
      audit: new FakeAuditLog().withAccounts(HOST),
      clock: new FakeClock(AT),
      notice,
    })

    const result = await makeDeleteOwnAccount({
      stepUp: async () => ok({ secondFactorUsed: false }),
      deleteAccount,
    })({ userId: HOST, password: 'un-mot-de-passe-solide' })

    expect(result.ok).toBe(true)
    expect(notice.events).toEqual(['prepare:accountDeleted', 'send:accountDeleted'])
  })

  it('sends nothing when the confirmation is refused', async () => {
    const users = new FakeUserRepository().seed(aUser({ id: 'user-1' }))
    const notice = new RecordingAccountNotice()
    const deleteAccount = makeDeleteAccount({
      users,
      clients: new FakeClientRepository(),
      holdings: new FakeAccountHoldings(),
      audit: new FakeAuditLog(),
      clock: new FakeClock(AT),
      notice,
    })

    const result = await makeDeleteOwnAccount({
      stepUp: async () => err(DomainError.unauthenticated('auth.invalidCredentials')),
      deleteAccount,
    })({ userId: HOST, password: 'faux' })

    expect(result.ok).toBe(false)
    expect(notice.events).toEqual([])
  })
})
