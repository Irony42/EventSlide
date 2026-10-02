import { beforeEach, describe, expect, it } from 'vitest'
import type { AuditActorInput } from '../../../domain/audit/auditActor'
import { asUserId } from '../../../domain/shared/ids'
import { AT, aUser } from '../../testing/builders'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClock } from '../../testing/fakeClock'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { makeDisableAccount } from './disableAccount'

const OPERATOR = { kind: 'operator', userId: asUserId('user-operator') } as const

describe('disableAccount', () => {
  let users: FakeUserRepository
  let audit: FakeAuditLog
  let clock: FakeClock

  const disable = (userId = 'user-1', actor: AuditActorInput = OPERATOR) =>
    makeDisableAccount({ users, audit, clock })({ userId: asUserId(userId), actor })

  beforeEach(() => {
    users = new FakeUserRepository().seed(
      aUser({ id: 'user-1', email: 'moderateur@example.test' }),
      aUser({ id: 'user-operator', email: 'operateur@example.test', siteRole: 'operator' }),
    )
    audit = new FakeAuditLog().withAccounts(asUserId('user-operator'))
    clock = new FakeClock(AT)
  })

  it('switches the account off', async () => {
    const result = await disable()

    expect(result.ok).toBe(true)
    expect((await users.findById(asUserId('user-1')))?.isDisabled()).toBe(true)
  })

  it('ends every session the account has, and keeps them ended after it is enabled again', async () => {
    clock.advance(45_000)

    await disable()

    const stored = await users.findById(asUserId('user-1'))
    await users.save((stored ?? aUser()).enable())
    const state = await users.authStateFor(asUserId('user-1'))
    expect(state.active).toBe(true)
    expect(state.credentialsChangedAt?.toISOString()).toBe(clock.now().toISOString())
  })

  it('records who switched it off, with nothing that identifies the person', async () => {
    await disable()

    const { items } = await audit.list({ limit: 10 })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      action: 'account.disabled',
      subject: { type: 'account', id: 'user-1' },
      actor: { kind: 'operator', userId: 'user-operator' },
      clientId: null,
      details: {},
    })
  })

  it('refuses an actor the log refuses, and then changes nothing', async () => {
    const result = await disable('user-1', { kind: 'operator' })

    expect(result.ok).toBe(false)
    expect((await users.findById(asUserId('user-1')))?.isDisabled()).toBe(false)
    expect((await audit.list({ limit: 10 })).items).toHaveLength(0)
  })

  it('leaves the account switched on when the log cannot take the entry, rather than switching it off unrecorded', async () => {
    // Write-ahead: the entry goes in before the change. An audit log that refuses the actor
    // (here, an account it has never heard of) must therefore stop the switch-off, since the
    // other order leaves an account off with nobody able to say who did it.
    audit = new FakeAuditLog()

    await expect(disable()).rejects.toThrow(/FOREIGN KEY/)

    expect((await users.findById(asUserId('user-1')))?.isDisabled()).toBe(false)
  })

  it('does nothing and says nothing the second time, so the first moment is the one on record', async () => {
    await disable()
    clock.advance(60_000)

    const again = await disable()

    expect(again.ok).toBe(true)
    expect((await users.findById(asUserId('user-1')))?.disabledAt?.toISOString()).toBe(
      AT.toISOString(),
    )
    expect((await audit.list({ limit: 10 })).items).toHaveLength(1)
  })

  it('refuses an account that does not exist', async () => {
    const result = await disable('nobody')

    expect(!result.ok && result.error.code).toBe('user.notFound')
    expect((await audit.list({ limit: 10 })).items).toHaveLength(0)
  })
})
