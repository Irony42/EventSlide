import { beforeEach, describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import { User } from '../../../domain/users/user'
import { AT } from '../../testing/builders'
import { FakeAccountHoldings } from '../../testing/fakeAccountHoldings'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { PASSWORD, USER, aSecondFactorWorld } from '../../testing/secondFactorWorld'
import { makeDeleteAccount } from '../site/deleteAccount'
import { makeDeleteOwnAccount, type DeleteOwnAccount } from './deleteOwnAccount'

/**
 * A person erases their own account: the confirmation is a step-up (the password, and the
 * authenticator's code when there is one), the operator's refusals stand, and the line left
 * behind is the person's own act.
 */

describe('deleteOwnAccount', () => {
  let world: ReturnType<typeof aSecondFactorWorld>
  let holdings: FakeAccountHoldings
  let remove: DeleteOwnAccount

  beforeEach(() => {
    world = aSecondFactorWorld({ siteRole: 'none' })
    holdings = new FakeAccountHoldings()
    remove = makeDeleteOwnAccount({
      stepUp: world.stepUp,
      deleteAccount: makeDeleteAccount({
        users: world.users,
        clients: new FakeClientRepository(),
        holdings,
        audit: world.audit,
        clock: new FakeClock(AT),
      }),
    })
  })

  /** Authenticators are enrolled by operators only; the account is then an ordinary one again. */
  const withAuthenticator = async () => {
    const operator = aSecondFactorWorld({ siteRole: 'operator' })
    const { secret } = await operator.enrolled()
    const stored = await operator.users.findById(USER)
    if (stored === null) throw new Error('the operator is missing')
    await operator.users.save(User.restore({ ...stored.toProps(), siteRole: 'none' }))
    world = operator
    holdings = new FakeAccountHoldings()
    remove = makeDeleteOwnAccount({
      stepUp: world.stepUp,
      deleteAccount: makeDeleteAccount({
        users: world.users,
        clients: new FakeClientRepository(),
        holdings,
        audit: world.audit,
        clock: new FakeClock(AT),
      }),
    })
    return secret
  }

  const exists = async () => (await world.users.findById(USER)) !== null
  const logged = async () => (await world.audit.list({ limit: 10 })).items

  it('deletes the account of a person who gives its password, and records it as their own act', async () => {
    const result = await remove({ userId: USER, password: PASSWORD })

    expect(result.ok).toBe(true)
    expect(await exists()).toBe(false)
    expect(await logged()).toMatchObject([
      {
        action: 'account.deleted',
        subject: { type: 'account', id: USER },
        actor: { kind: 'member' },
      },
    ])
  })

  it('refuses a wrong password with the answer a failed sign-in gives, and deletes nothing', async () => {
    const result = await remove({ userId: USER, password: 'pas-le-bon-mot-de-passe' })

    expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
      'unauthenticated',
      'auth.invalidCredentials',
    ])
    expect(await exists()).toBe(true)
    expect(await logged()).toEqual([])
  })

  it('wants the authenticator as well when the account has one: the password alone deletes nothing', async () => {
    await withAuthenticator()

    const result = await remove({ userId: USER, password: PASSWORD })

    expect(!result.ok && result.error.code).toBe('auth.invalidSecondFactor')
    expect(await exists()).toBe(true)
    expect(await logged()).not.toContainEqual(
      expect.objectContaining({ action: 'account.deleted' }),
    )
  })

  it('refuses a wrong code for an account that has an authenticator, and deletes nothing', async () => {
    await withAuthenticator()

    const result = await remove({ userId: USER, password: PASSWORD, proof: { code: '000000' } })

    expect(!result.ok && result.error.code).toBe('auth.invalidSecondFactor')
    expect(await exists()).toBe(true)
  })

  it('deletes an account that has an authenticator when the password and a fresh code are given', async () => {
    const secret = await withAuthenticator()
    // The enrolment spent the current step: the next one is the one the app shows now.
    const code = world.codeFor(secret, 1)

    const result = await remove({ userId: USER, password: PASSWORD, proof: { code } })

    expect(result.ok).toBe(true)
    expect(await exists()).toBe(false)
  })

  it('answers 401 when the account is already gone under the session', async () => {
    const result = await remove({ userId: asUserId('user-ghost'), password: PASSWORD })

    expect(!result.ok && result.error.code).toBe('auth.required')
  })

  it('keeps the operator’s refusal for an account that owns an event', async () => {
    holdings.holds(USER, { events: 1 })

    const result = await remove({ userId: USER, password: PASSWORD })

    expect(!result.ok && result.error.code).toBe('account.holdsEvents')
    expect(await exists()).toBe(true)
  })

  it('keeps the refusal for an operator’s own account', async () => {
    const operator = aSecondFactorWorld({ siteRole: 'operator' })
    const removeOperator = makeDeleteOwnAccount({
      stepUp: operator.stepUp,
      deleteAccount: makeDeleteAccount({
        users: operator.users,
        clients: new FakeClientRepository(),
        holdings,
        audit: operator.audit,
        clock: new FakeClock(AT),
      }),
    })

    const result = await removeOperator({ userId: USER, password: PASSWORD })

    expect(!result.ok && result.error.code).toBe('account.operatorProtected')
    expect((await operator.users.findById(USER)) !== null).toBe(true)
  })
})
