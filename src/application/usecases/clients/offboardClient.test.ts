import { beforeEach, describe, expect, it } from 'vitest'
import { asClientId, asEventId, asUserId } from '../../../domain/shared/ids'
import type { AuditRecorder } from '../../ports/auditLog'
import { AT, aClient, anEvent, atPlus } from '../../testing/builders'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { makeOffboardClient, type OffboardClient } from './offboardClient'

/**
 * Ending an engagement (G2-14 part 3): what moves, what is dated, what is recorded and in which
 * order, and that asking twice changes nothing.
 */

const OPERATOR = { kind: 'operator', userId: asUserId('user-operator') } as const
const CLIENT = asClientId('client-1')
const NOW = atPlus(86_400_000)
const DAY = 86_400_000

describe('offboardClient', () => {
  let clients: FakeClientRepository
  let events: FakeEventRepository
  let audit: FakeAuditLog
  let offboard: OffboardClient

  beforeEach(() => {
    clients = new FakeClientRepository().seed(
      aClient({ id: 'client-1' }),
      aClient({ id: 'client-2', name: 'Studio Sacha' }),
    )
    events = new FakeEventRepository({ memberships: new FakeMembershipRepository(), clients })
    events.seed(
      anEvent({
        id: 'live',
        slug: 'en-cours',
        joinCode: 'AAAAAA',
        status: 'live',
        clientId: 'client-1',
      }),
      anEvent({
        id: 'draft',
        slug: 'brouillon',
        joinCode: 'BBBBBB',
        status: 'draft',
        clientId: 'client-1',
      }),
      anEvent({
        id: 'closed',
        slug: 'termine',
        joinCode: 'CCCCCC',
        status: 'closed',
        clientId: 'client-1',
      }),
      anEvent({
        id: 'archived',
        slug: 'archive',
        joinCode: 'DDDDDD',
        status: 'archived',
        clientId: 'client-1',
      }),
      anEvent({
        id: 'other',
        slug: 'autre',
        joinCode: 'EEEEEE',
        status: 'live',
        clientId: 'client-2',
      }),
    )
    audit = new FakeAuditLog().withAccounts(OPERATOR.userId)
    offboard = makeOffboardClient({ clients, events, audit, clock: new FakeClock(NOW) })
  })

  const statusOf = async (id: string) => (await events.findById(asEventId(id)))?.status

  it('closes the live events, archives the drafts, and leaves the closed and the archived as they are', async () => {
    const result = await offboard({ clientId: CLIENT, actor: OPERATOR, graceDays: 30 })

    expect(result.ok).toBe(true)
    expect([
      await statusOf('live'),
      await statusOf('draft'),
      await statusOf('closed'),
      await statusOf('archived'),
    ]).toEqual(['closed', 'archived', 'closed', 'archived'])
  })

  it('touches no event of another client', async () => {
    await offboard({ clientId: CLIENT, actor: OPERATOR, graceDays: 30 })

    expect(await statusOf('other')).toBe('live')
    expect((await clients.findById(asClientId('client-2')))?.isOffboarding()).toBe(false)
  })

  it('freezes the client and dates the purge of its albums graceDays from now', async () => {
    await offboard({ clientId: CLIENT, actor: OPERATOR, graceDays: 30 })

    const stored = await clients.findById(CLIENT)
    expect(stored?.isSuspended()).toBe(true)
    expect(stored?.suspendedAt).toEqual(NOW)
    expect(stored?.purgeAfter).toEqual(new Date(NOW.getTime() + 30 * DAY))
  })

  it('records one line with the window and the counts, never which events', async () => {
    await offboard({ clientId: CLIENT, actor: OPERATOR, graceDays: 30 })

    expect(audit.all()).toEqual([
      {
        seq: 1,
        at: NOW,
        actor: { kind: 'operator', userId: OPERATOR.userId, label: null },
        action: 'client.offboarded',
        subject: { type: 'client', id: 'client-1' },
        clientId: CLIENT,
        details: { graceDays: 30, closed: 1, archived: 1 },
      },
    ])
  })

  it('is idempotent: a second call keeps the first date, moves nothing and writes no second line', async () => {
    await offboard({ clientId: CLIENT, actor: OPERATOR, graceDays: 30 })
    const later = makeOffboardClient({
      clients,
      events,
      audit,
      clock: new FakeClock(atPlus(5 * DAY)),
    })

    const again = await later({ clientId: CLIENT, actor: OPERATOR, graceDays: 365 })

    expect(again.ok).toBe(true)
    expect((await clients.findById(CLIENT))?.purgeAfter).toEqual(new Date(NOW.getTime() + 30 * DAY))
    expect(audit.all()).toHaveLength(1)
  })

  it.each([0, -1, 366, 1.5, Number.NaN])(
    'refuses a window of %s days with 400 client.graceInvalid, before reading anything',
    async (graceDays) => {
      const result = await offboard({ clientId: asClientId('ghost'), actor: OPERATOR, graceDays })

      expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
        'invalid',
        'client.graceInvalid',
      ])
    },
  )

  it.each([1, 365])('accepts a window of %s days, the two ends of the range', async (graceDays) => {
    const result = await offboard({ clientId: CLIENT, actor: OPERATOR, graceDays })

    expect(result.ok).toBe(true)
    expect((await clients.findById(CLIENT))?.purgeAfter).toEqual(
      new Date(NOW.getTime() + graceDays * DAY),
    )
  })

  it('answers client.notFound for a client that does not exist, and writes nothing', async () => {
    const result = await offboard({ clientId: asClientId('ghost'), actor: OPERATOR, graceDays: 30 })

    expect(!result.ok && result.error.code).toBe('client.notFound')
    expect(audit.all()).toEqual([])
  })

  it('refuses an actor that is not an account, and moves nothing', async () => {
    const result = await offboard({ clientId: CLIENT, actor: { kind: 'operator' }, graceDays: 30 })

    expect(!result.ok && result.error.code).toBe('audit.actorUserRequired')
    expect(await statusOf('live')).toBe('live')
    expect((await clients.findById(CLIENT))?.isOffboarding()).toBe(false)
  })

  it('records before it changes anything: a failure to write the line leaves everything as it was', async () => {
    const broken: AuditRecorder = {
      record: async () => {
        throw new Error('disk full')
      },
    }
    const failing = makeOffboardClient({
      clients,
      events,
      audit: broken,
      clock: new FakeClock(NOW),
    })

    await expect(failing({ clientId: CLIENT, actor: OPERATOR, graceDays: 30 })).rejects.toThrow(
      'disk full',
    )

    expect(await statusOf('live')).toBe('live')
    expect((await clients.findById(CLIENT))?.isOffboarding()).toBe(false)
  })

  it('has nothing to move for a client with no event, and still dates it', async () => {
    const empty = makeOffboardClient({ clients, events, audit, clock: new FakeClock(NOW) })

    await empty({ clientId: asClientId('client-2'), actor: OPERATOR, graceDays: 7 })

    expect(audit.all()[0]?.details).toEqual({ graceDays: 7, closed: 1, archived: 0 })
  })

  it('reads the instant AT of the fixtures as before any of it', () => {
    expect(NOW.getTime()).toBeGreaterThan(AT.getTime())
  })
})
