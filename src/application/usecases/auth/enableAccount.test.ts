import { beforeEach, describe, expect, it } from 'vitest'
import { asClientId, asUserId } from '../../../domain/shared/ids'
import { AT, aClient, aUser } from '../../testing/builders'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { makeEnableAccount } from './enableAccount'

const OPERATOR = { kind: 'operator', userId: asUserId('user-operator') } as const

describe('enableAccount (G2-14 part 3)', () => {
  let users: FakeUserRepository
  let clients: FakeClientRepository
  let audit: FakeAuditLog
  let enable: ReturnType<typeof makeEnableAccount>

  beforeEach(() => {
    users = new FakeUserRepository().seed(
      aUser({ id: 'user-1', email: 'moderateur@example.test' }).disable(AT),
      aUser({ id: 'user-operator', email: 'operateur@example.test', siteRole: 'operator' }),
    )
    clients = new FakeClientRepository().seed(aClient({ id: 'client-1' }))
    audit = new FakeAuditLog().withAccounts(asUserId('user-operator'))
    enable = makeEnableAccount({ users, clients, audit, clock: new FakeClock(AT) })
  })

  it('switches the account back on and writes one line per client, each carrying that client', async () => {
    await clients.grantMember({
      clientId: asClientId('client-1'),
      userId: asUserId('user-1'),
      role: 'member',
      grantedAt: AT,
    })

    const result = await enable({ userId: asUserId('user-1'), actor: OPERATOR })

    expect(result.ok).toBe(true)
    expect((await users.findById(asUserId('user-1')))?.isDisabled()).toBe(false)
    expect((await audit.list({ limit: 10 })).items).toMatchObject([
      {
        action: 'account.enabled',
        subject: { type: 'account', id: 'user-1' },
        clientId: 'client-1',
        actor: { kind: 'operator', userId: 'user-operator' },
      },
    ])
  })

  it('writes a line for every client the account belongs to, not only the first', async () => {
    clients.seed(aClient({ id: 'client-2', name: 'Studio Sacha' }))
    for (const clientId of ['client-1', 'client-2']) {
      await clients.grantMember({
        clientId: asClientId(clientId),
        userId: asUserId('user-1'),
        role: 'member',
        grantedAt: AT,
      })
    }

    await enable({ userId: asUserId('user-1'), actor: OPERATOR })

    const { items } = await audit.list({ limit: 10 })
    expect(items.map((item) => item.clientId).sort()).toEqual(['client-1', 'client-2'])
  })

  it('writes one line with no client for an account that belongs to none', async () => {
    await enable({ userId: asUserId('user-1'), actor: OPERATOR })

    expect((await audit.list({ limit: 10 })).items).toMatchObject([
      { action: 'account.enabled', clientId: null },
    ])
  })

  it('keeps the sessions it ended ended: the credentials epoch is not lowered by enabling', async () => {
    await enable({ userId: asUserId('user-1'), actor: OPERATOR })

    const state = await users.authStateFor(asUserId('user-1'))
    expect(state.active).toBe(true)
    expect(state.credentialsChangedAt?.toISOString()).toBe(AT.toISOString())
  })

  it('is idempotent: an account that is on is left alone and no line is written', async () => {
    await enable({ userId: asUserId('user-1'), actor: OPERATOR })
    await enable({ userId: asUserId('user-1'), actor: OPERATOR })
    await enable({ userId: asUserId('user-operator'), actor: OPERATOR })

    expect((await audit.list({ limit: 10 })).items).toHaveLength(1)
  })

  it('answers user.notFound for an account that does not exist', async () => {
    const result = await enable({ userId: asUserId('ghost'), actor: OPERATOR })

    expect(!result.ok && result.error.code).toBe('user.notFound')
  })

  it('refuses an actor that is not an account, and leaves the account off', async () => {
    const result = await enable({ userId: asUserId('user-1'), actor: { kind: 'operator' } })

    expect(!result.ok && result.error.code).toBe('audit.actorUserRequired')
    expect((await users.findById(asUserId('user-1')))?.isDisabled()).toBe(true)
  })
})
