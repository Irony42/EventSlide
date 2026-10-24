import { beforeEach, describe, expect, it } from 'vitest'
import { asClientId, asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, aClient, aUser, anEvent, atPlus } from '../../testing/builders'
import { FakeAccountHoldings } from '../../testing/fakeAccountHoldings'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import {
  FINALIZE_BATCH,
  makeFinalizeOffboardedClients,
  type FinalizeOffboardedClients,
} from './finalizeOffboardedClients'

/**
 * The end of an offboarding (G2-14 part 3): which accounts go with the client and which stay, what
 * is recorded, and that nothing is finished before its time.
 */

const CLIENT = asClientId('client-1')
const OTHER = asClientId('client-2')
const DUE = atPlus(10_000)

describe('finalizeOffboardedClients', () => {
  let clients: FakeClientRepository
  let users: FakeUserRepository
  let holdings: FakeAccountHoldings
  let audit: FakeAuditLog
  let events: FakeEventRepository
  let finalize: FinalizeOffboardedClients

  const seat = (clientId: typeof CLIENT, userId: string, role: 'owner' | 'member' = 'member') =>
    clients.grantMember({ clientId, userId: asUserId(userId), role, grantedAt: AT })

  beforeEach(async () => {
    clients = new FakeClientRepository().seed(
      aClient({ id: 'client-1', purgeAfter: atPlus(5_000) }),
      aClient({ id: 'client-2', name: 'Studio Sacha' }),
    )
    users = new FakeUserRepository().seed(
      aUser({ id: 'user-owner', email: 'proprietaire@example.test' }),
      aUser({ id: 'user-member', email: 'membre@example.test' }),
      aUser({ id: 'user-shared', email: 'partage@example.test' }),
      aUser({ id: 'user-operator', email: 'operateur@example.test', siteRole: 'operator' }),
    )
    holdings = new FakeAccountHoldings()
    audit = new FakeAuditLog()
    events = new FakeEventRepository({ memberships: new FakeMembershipRepository(), clients })
    finalize = makeFinalizeOffboardedClients({
      clients,
      users,
      holdings,
      audit,
      clock: new FakeClock(DUE),
    })
    await seat(CLIENT, 'user-owner', 'owner')
    await seat(CLIENT, 'user-member')
    await seat(CLIENT, 'user-shared')
    await seat(OTHER, 'user-shared')
  })

  const exists = async (id: string) => (await users.findById(asUserId(id))) !== null

  it('deletes the accounts that were nothing but the client’s, and the client', async () => {
    const report = await finalize()

    expect(report).toEqual({ finalized: [CLIENT], accountsDeleted: 2, failed: [] })
    expect(await exists('user-owner')).toBe(false)
    expect(await exists('user-member')).toBe(false)
    expect(await clients.findById(CLIENT)).toBeNull()
  })

  it('keeps an account that belongs to another client, and only removes it from this one', async () => {
    await finalize()

    expect(await exists('user-shared')).toBe(true)
    expect(await clients.memberRole(OTHER, asUserId('user-shared'))).toBe('member')
    expect(await clients.memberRole(CLIENT, asUserId('user-shared'))).toBeNull()
  })

  it.each([
    ['owns an event', { events: 1 }],
    ['wrote media', { media: 1 }],
    ['has a part in an event', { eventMemberships: 1 }],
  ] as const)('keeps an account that %s, and still finalises the client', async (_name, held) => {
    holdings.holds(asUserId('user-member'), held)

    const report = await finalize()

    expect(await exists('user-member')).toBe(true)
    expect(report.finalized).toEqual([CLIENT])
  })

  it('never deletes an operator, whose account is one of the client’s members', async () => {
    await seat(CLIENT, 'user-operator')

    await finalize()

    expect(await exists('user-operator')).toBe(true)
    expect(await clients.findById(CLIENT)).toBeNull()
  })

  it('writes one account.deleted line per account and one client.finalized, by the sweeper, carrying the client', async () => {
    await finalize()

    const lines = audit.all()
    expect(lines.map((line) => [line.action, line.subject.id, line.clientId])).toEqual([
      ['account.deleted', 'user-member', 'client-1'],
      ['account.deleted', 'user-owner', 'client-1'],
      ['client.finalized', 'client-1', 'client-1'],
    ])
    expect(
      lines.every(
        (line) => line.actor.kind === 'system' && line.actor.label === 'retention-sweeper',
      ),
    ).toBe(true)
  })

  it('waits for the deadline: a client whose date has not passed is left alone', async () => {
    const early = makeFinalizeOffboardedClients({
      clients,
      users,
      holdings,
      audit,
      clock: new FakeClock(atPlus(4_999)),
    })

    expect(await early()).toEqual({ finalized: [], accountsDeleted: 0, failed: [] })
    expect(await clients.findById(CLIENT)).not.toBeNull()
    expect(audit.all()).toEqual([])
  })

  it('waits for the albums: a client that still holds an event is not finalised', async () => {
    events.seed(anEvent({ id: 'wedding', clientId: 'client-1', status: 'closed' }))

    expect((await finalize()).finalized).toEqual([])
    expect(await exists('user-owner')).toBe(true)
    expect(await events.findById(asEventId('wedding'))).not.toBeNull()
  })

  it('leaves a client that was never offboarded alone, however empty', async () => {
    await finalize()

    expect(await clients.findById(OTHER)).not.toBeNull()
  })

  it('does at most one batch of clients a sweep', async () => {
    for (let i = 0; i < FINALIZE_BATCH + 3; i += 1) {
      clients.seed(
        aClient({ id: `batch-${String(i).padStart(3, '0')}`, purgeAfter: atPlus(1_000) }),
      )
    }

    const report = await finalize()

    expect(report.finalized).toHaveLength(FINALIZE_BATCH)
  })

  it('reports a client it could not finish and goes on to the next', async () => {
    clients.seed(aClient({ id: 'client-0', purgeAfter: atPlus(1_000) }))
    const boom = makeFinalizeOffboardedClients({
      clients: Object.assign(Object.create(clients) as typeof clients, {
        memberIds: async (id: typeof CLIENT) => {
          if (id === asClientId('client-0')) throw new Error('database is locked')
          return clients.memberIds(id)
        },
      }),
      users,
      holdings,
      audit,
      clock: new FakeClock(DUE),
    })

    const report = await boom()

    expect(report.failed).toEqual([asClientId('client-0')])
    expect(report.finalized).toEqual([CLIENT])
  })
})
