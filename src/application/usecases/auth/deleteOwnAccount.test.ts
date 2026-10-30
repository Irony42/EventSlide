import { beforeEach, describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import { AT, aUser } from '../../testing/builders'
import { FakeAccountHoldings } from '../../testing/fakeAccountHoldings'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakePasswordHasher } from '../../testing/fakePasswordHasher'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { makeDeleteAccount } from '../site/deleteAccount'
import { makeDeleteOwnAccount, type DeleteOwnAccount } from './deleteOwnAccount'

/**
 * A person erases their own account: the password is asked, the operator's refusals stand, and the
 * line left behind is the person's own act, with an id that points at nobody once they are gone.
 */

const PERSON = asUserId('user-person')
const PASSWORD = 'un-mot-de-passe-solide'

describe('deleteOwnAccount', () => {
  let users: FakeUserRepository
  let holdings: FakeAccountHoldings
  let audit: FakeAuditLog
  let remove: DeleteOwnAccount

  beforeEach(() => {
    users = new FakeUserRepository().seed(
      aUser({ id: 'user-person', email: 'personne@example.test' }),
      aUser({ id: 'user-operator', email: 'operateur@example.test', siteRole: 'operator' }),
    )
    holdings = new FakeAccountHoldings()
    audit = new FakeAuditLog().withAccounts(PERSON)
    remove = makeDeleteOwnAccount({
      users,
      hasher: new FakePasswordHasher(),
      deleteAccount: makeDeleteAccount({
        users,
        clients: new FakeClientRepository(),
        holdings,
        audit,
        clock: new FakeClock(AT),
      }),
    })
  })

  const exists = async (id: string) => (await users.findById(asUserId(id))) !== null

  it('deletes the account of a person who gives its password, and records it as their own act', async () => {
    const result = await remove({ userId: PERSON, password: PASSWORD })

    expect(result.ok).toBe(true)
    expect(await exists('user-person')).toBe(false)
    expect((await audit.list({ limit: 10 })).items).toMatchObject([
      {
        action: 'account.deleted',
        subject: { type: 'account', id: 'user-person' },
        actor: { kind: 'member' },
      },
    ])
  })

  it('refuses a wrong password with the answer a failed sign-in gives, and deletes nothing', async () => {
    const result = await remove({ userId: PERSON, password: 'pas-le-bon-mot-de-passe' })

    expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
      'unauthenticated',
      'auth.invalidCredentials',
    ])
    expect(await exists('user-person')).toBe(true)
    expect((await audit.list({ limit: 10 })).items).toEqual([])
  })

  it('answers 404 when the account is already gone under the session', async () => {
    const result = await remove({ userId: asUserId('user-ghost'), password: PASSWORD })

    expect(!result.ok && result.error.code).toBe('user.notFound')
  })

  it('keeps the operator’s refusal for an account that owns an event', async () => {
    holdings.holds(PERSON, { events: 1 })

    const result = await remove({ userId: PERSON, password: PASSWORD })

    expect(!result.ok && result.error.code).toBe('account.holdsEvents')
    expect(await exists('user-person')).toBe(true)
  })

  it('keeps the refusal for an operator’s own account', async () => {
    const result = await remove({ userId: asUserId('user-operator'), password: PASSWORD })

    expect(!result.ok && result.error.code).toBe('account.operatorProtected')
    expect(await exists('user-operator')).toBe(true)
  })
})
