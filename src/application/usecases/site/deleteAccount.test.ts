import { beforeEach, describe, expect, it } from 'vitest'
import { asClientId, asUserId } from '../../../domain/shared/ids'
import type { AuditRecorder } from '../../ports/auditLog'
import { AT, aClient, aUser } from '../../testing/builders'
import { FakeAccountHoldings } from '../../testing/fakeAccountHoldings'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { makeDeleteAccount, type DeleteAccount } from './deleteAccount'

/**
 * Erasing a person (GDPR, G2-14 part 3): what is refused, what is recorded and in which order, and
 * that nothing else about the account is touched.
 */

const OPERATOR = { kind: 'operator', userId: asUserId('user-operator') } as const
const PERSON = asUserId('user-person')

describe('deleteAccount', () => {
  let users: FakeUserRepository
  let clients: FakeClientRepository
  let holdings: FakeAccountHoldings
  let audit: FakeAuditLog
  let remove: DeleteAccount

  beforeEach(() => {
    users = new FakeUserRepository().seed(
      aUser({ id: 'user-person', email: 'personne@example.test' }),
      aUser({ id: 'user-operator', email: 'operateur@example.test', siteRole: 'operator' }),
      aUser({ id: 'user-peer', email: 'pair@example.test', siteRole: 'operator' }),
    )
    clients = new FakeClientRepository()
    holdings = new FakeAccountHoldings()
    audit = new FakeAuditLog().withAccounts(asUserId('user-operator'))
    remove = makeDeleteAccount({ users, clients, holdings, audit, clock: new FakeClock(AT) })
  })

  const exists = async (id: string) => (await users.findById(asUserId(id))) !== null

  it('deletes the account and records it, once, with no client when it belonged to none', async () => {
    const result = await remove({ userId: PERSON, actor: OPERATOR })

    expect(result.ok).toBe(true)
    expect(await exists('user-person')).toBe(false)
    expect((await audit.list({ limit: 10 })).items).toMatchObject([
      {
        action: 'account.deleted',
        subject: { type: 'account', id: 'user-person' },
        clientId: null,
        actor: { kind: 'operator', userId: 'user-operator' },
        details: {},
      },
    ])
  })

  it('records one line per client the account belonged to, each carrying that client', async () => {
    for (const id of ['client-1', 'client-2']) {
      clients.seed(aClient({ id }))
      await clients.grantMember({
        clientId: asClientId(id),
        userId: PERSON,
        role: 'member',
        grantedAt: AT,
      })
    }

    await remove({ userId: PERSON, actor: OPERATOR })

    const { items } = await audit.list({ limit: 10 })
    expect(items.map((item) => item.clientId).sort()).toEqual(['client-1', 'client-2'])
  })

  it('refuses an operator, another one or itself, and deletes nothing', async () => {
    for (const target of ['user-peer', 'user-operator']) {
      const result = await remove({ userId: asUserId(target), actor: OPERATOR })

      expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
        'forbidden',
        'account.operatorProtected',
      ])
      expect(await exists(target)).toBe(true)
    }
    expect((await audit.list({ limit: 10 })).items).toEqual([])
  })

  it('refuses an account that owns an event, with 409 account.holdsEvents: an album is somebody’s', async () => {
    holdings.holds(PERSON, { events: 1 })

    const result = await remove({ userId: PERSON, actor: OPERATOR })

    expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
      'conflict',
      'account.holdsEvents',
    ])
    expect(await exists('user-person')).toBe(true)
    expect((await audit.list({ limit: 10 })).items).toEqual([])
  })

  it('refuses an account that wrote media, with 409 account.holdsMedia: its files would stay on disk', async () => {
    holdings.holds(PERSON, { media: 2 })

    const result = await remove({ userId: PERSON, actor: OPERATOR })

    expect(!result.ok && result.error.code).toBe('account.holdsMedia')
    expect(await exists('user-person')).toBe(true)
  })

  it('deletes an account that moderates somebody else’s event: that part is removed with it', async () => {
    holdings.holds(PERSON, { eventMemberships: 3 })

    expect((await remove({ userId: PERSON, actor: OPERATOR })).ok).toBe(true)
    expect(await exists('user-person')).toBe(false)
  })

  it('answers user.notFound for an account that does not exist, and for one already deleted', async () => {
    await remove({ userId: PERSON, actor: OPERATOR })

    const again = await remove({ userId: PERSON, actor: OPERATOR })

    expect(!again.ok && again.error.code).toBe('user.notFound')
    expect((await audit.list({ limit: 10 })).items).toHaveLength(1)
  })

  it('refuses an actor that is not an account, and deletes nothing: no erasure without a name behind it', async () => {
    const result = await remove({ userId: PERSON, actor: { kind: 'operator' } })

    expect(!result.ok && result.error.code).toBe('audit.actorUserRequired')
    expect(await exists('user-person')).toBe(true)
  })

  it('records before it deletes: a failure to write the line leaves the account in place', async () => {
    const broken: AuditRecorder = {
      record: async () => {
        throw new Error('disk full')
      },
    }
    const failing = makeDeleteAccount({
      users,
      clients,
      holdings,
      audit: broken,
      clock: new FakeClock(AT),
    })

    await expect(failing({ userId: PERSON, actor: OPERATOR })).rejects.toThrow('disk full')

    expect(await exists('user-person')).toBe(true)
  })
})
