import { beforeEach, describe, expect, it } from 'vitest'
import { asAccountTokenId, asClientId, asEventId, asUserId } from '../../../domain/shared/ids'
import {
  AT,
  aClient,
  aClientCeilings,
  aPhoto,
  anAccountToken,
  anAuditEntry,
  anEvent,
  atPlus,
} from '../../testing/builders'
import { FakeAccountTokenRepository } from '../../testing/fakeAccountTokenRepository'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { makeGetEventLimits } from '../events/getEventLimits'
import { makeGetClientLimits } from './getClientLimits'
import { makeListClientAudit } from './listClientAudit'
import { PENDING_INVITATIONS_LIMIT, makeListPendingInvitations } from './listPendingInvitations'

/**
 * The client's own space, as use cases (G2-16 / P3-17): what `/api/me/limits`, the readable
 * audit and the list of what waits for an owner are made of.
 *
 * One world, two clients. Every case that reads one client's side asserts the other's is
 * absent, because "never another client's" is the rule these use cases exist to hold.
 */

const OWNER_A = asUserId('owner-a')
const MEMBER_A = asUserId('member-a')
const OWNER_B = asUserId('owner-b')
const BOTH = asUserId('owner-of-both')
const STRANGER = asUserId('stranger')
const OPERATOR = asUserId('user-operator')
const A = asClientId('client-a')
const B = asClientId('client-b')
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

describe('the client space', () => {
  let clients: FakeClientRepository
  let photos: FakePhotoRepository
  let audit: FakeAuditLog
  let tokens: FakeAccountTokenRepository
  let clock: FakeClock

  beforeEach(async () => {
    clients = new FakeClientRepository().seed(
      aClient({
        id: A,
        name: 'Atelier A',
        ceilings: aClientCeilings({ maxEvents: 3, maxTotalBytes: 1_000, maxEventsPerPeriod: 10 }),
        eventsCreatedInPeriod: 4,
      }),
      aClient({ id: B, name: 'Atelier B', suspendedAt: AT }),
    )
    photos = new FakePhotoRepository().chargeClientBytesFrom(clients)
    audit = new FakeAuditLog().withAccounts(OPERATOR, OWNER_A)
    tokens = new FakeAccountTokenRepository()
      .withAccounts(OPERATOR, OWNER_A, OWNER_B)
      .withClients(A, B)
    clock = new FakeClock()
    for (const [clientId, userId, role] of [
      [A, OWNER_A, 'owner'],
      [A, MEMBER_A, 'member'],
      [B, OWNER_B, 'owner'],
      [A, BOTH, 'owner'],
      [B, BOTH, 'owner'],
    ] as const) {
      await clients.grantMember({ clientId, userId, role, grantedAt: AT })
    }
  })

  describe('getClientLimits', () => {
    const limits = (userId: typeof OWNER_A) => makeGetClientLimits({ clients, photos })({ userId })

    it('reports the caller’s client with what the operator allows and what it has used', async () => {
      clients.linkEvent(asEventId('e1'), A)
      clients.linkEvent(asEventId('e2'), A)
      await photos.save(aPhoto({ id: 'p1', eventId: 'e1', byteSize: 400 }))

      const result = await limits(OWNER_A)

      expect(result.ok && result.value).toHaveLength(1)
      expect(result.ok && result.value[0]).toMatchObject({
        clientId: A,
        name: 'Atelier A',
        role: 'owner',
        suspended: false,
        ceilings: { maxEvents: 3, maxTotalBytes: 1_000, maxEventsPerPeriod: 10 },
        usage: { events: 2, eventsCreatedInPeriod: 4, usedBytes: 400 },
        meters: [
          { kind: 'events', used: 2, max: 3, level: 'ok' },
          { kind: 'eventsPerPeriod', used: 4, max: 10, level: 'ok' },
          { kind: 'storage', used: 400, max: 1_000, level: 'ok' },
        ],
      })
    })

    it('says what the caller is in the client, so a member is not shown an owner’s space', async () => {
      const result = await limits(MEMBER_A)

      expect(result.ok && result.value.map((item) => item.role)).toEqual(['member'])
    })

    it('says a suspended client is suspended', async () => {
      const result = await limits(OWNER_B)

      expect(result.ok && result.value[0]).toMatchObject({ clientId: B, suspended: true })
    })

    it('never reports a client the caller does not belong to, nor its usage', async () => {
      clients.linkEvent(asEventId('theirs'), B)
      await photos.save(aPhoto({ id: 'p-b', eventId: 'theirs', byteSize: 777 }))

      const result = await limits(OWNER_A)

      expect(result.ok && result.value.map((item) => item.clientId)).toEqual([A])
      expect(JSON.stringify(result)).not.toContain('Atelier B')
      expect(result.ok && result.value[0]?.usage.usedBytes).toBe(0)
    })

    it('reports every client of an account that belongs to several', async () => {
      const result = await limits(BOTH)

      expect(result.ok && result.value.map((item) => item.clientId).sort()).toEqual([A, B])
    })

    it('reports an account with no client as having none, which is not an error', async () => {
      expect(await limits(STRANGER)).toEqual({ ok: true, value: [] })
    })

    it('has no meter for a client with no ceiling', async () => {
      const result = await limits(OWNER_B)

      expect(result.ok && result.value[0]?.meters).toEqual([])
    })

    it('skips a membership whose client is gone, as a race with a deletion leaves it', async () => {
      clients.findById = async () => null

      expect(await limits(OWNER_A)).toEqual({ ok: true, value: [] })
    })
  })

  describe('listClientAudit', () => {
    const list = (input: { actorId: typeof OWNER_A; clientId?: typeof A; before?: number }) =>
      makeListClientAudit({ clients, audit })({ limit: 50, ...input })

    beforeEach(async () => {
      await audit.record(anAuditEntry({ clientId: 'client-a', at: atPlus(1) }))
      await audit.record(anAuditEntry({ clientId: 'client-b', at: atPlus(2) }))
      await audit.record(anAuditEntry({ clientId: 'client-a', at: atPlus(3) }))
    })

    it('gives an owner every entry about their client, newest first', async () => {
      const result = await list({ actorId: OWNER_A })

      expect(result.ok && result.value.items.map((item) => item.seq)).toEqual([3, 1])
    })

    it('never gives another client’s entry, even when the caller names it', async () => {
      const result = await list({ actorId: OWNER_A, clientId: B })

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'notFound', code: 'client.notFound' },
      })
    })

    it('refuses a member who is not an owner, in the client and knowing it exists', async () => {
      const result = await list({ actorId: MEMBER_A })

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'forbidden', code: 'client.ownerRequired' },
      })
    })

    it('answers an account with no client as it answers an unknown one', async () => {
      const result = await list({ actorId: STRANGER })

      expect(result).toMatchObject({ ok: false, error: { code: 'client.notFound' } })
    })

    it('needs an account in several clients to say which, and then reads only that one', async () => {
      const unnamed = await list({ actorId: BOTH })
      const named = await list({ actorId: BOTH, clientId: B })

      expect(unnamed).toMatchObject({ ok: false, error: { code: 'client.notFound' } })
      expect(named.ok && named.value.items.map((item) => item.seq)).toEqual([2])
    })

    it('pages from the cursor it was given', async () => {
      const result = await makeListClientAudit({ clients, audit })({
        actorId: OWNER_A,
        limit: 1,
        before: 3,
      })

      expect(result.ok && result.value.items.map((item) => item.seq)).toEqual([1])
    })
  })

  describe('listPendingInvitations', () => {
    const list = (actorId: typeof OWNER_A, clientId?: typeof A) =>
      makeListPendingInvitations({ clients, tokens, clock })({
        actorId,
        ...(clientId === undefined ? {} : { clientId }),
      })

    const invite = (id: string, over: Parameters<typeof anAccountToken>[0] = {}) =>
      anAccountToken({
        id,
        purpose: 'invitation',
        email: 'nouveau@example.test',
        userId: null,
        eventId: null,
        eventRole: null,
        clientId: 'client-a',
        clientRole: 'member',
        requiresApproval: true,
        delivery: 'link',
        createdBy: 'user-operator',
        ...over,
      })

    it('shows an owner whom each invitation is for, and for what, and nothing that opens it', async () => {
      await tokens.save(invite('inv-1', { clientRole: 'owner' }))

      const result = await list(OWNER_A)

      expect(result.ok && result.value).toEqual([
        {
          id: asAccountTokenId('inv-1'),
          clientId: A,
          email: 'nouveau@example.test',
          role: 'owner',
          createdAt: AT,
          expiresAt: atPlus(WEEK_MS),
        },
      ])
      expect(JSON.stringify(result)).not.toMatch(/digest|token|link/i)
    })

    it('never lists another client’s invitation', async () => {
      await tokens.save(invite('inv-b', { clientId: 'client-b' }))

      expect(await list(OWNER_A)).toEqual({ ok: true, value: [] })
    })

    it('leaves out what is no longer waiting: approved, or past its expiry', async () => {
      await tokens.save(invite('inv-approved'))
      await tokens.approve(asAccountTokenId('inv-approved'), OWNER_A, atPlus(1))
      await tokens.save(invite('inv-late', { email: 'tard@example.test' }))
      clock.advance(WEEK_MS + 1)

      expect(await list(OWNER_A)).toEqual({ ok: true, value: [] })
    })

    it('refuses a member who is not an owner, and answers a stranger as for an unknown client', async () => {
      expect(await list(MEMBER_A)).toMatchObject({
        ok: false,
        error: { code: 'client.ownerRequired' },
      })
      expect(await list(STRANGER)).toMatchObject({ ok: false, error: { code: 'client.notFound' } })
    })

    it('asks the store for at most the limit it names', async () => {
      for (let n = 0; n < PENDING_INVITATIONS_LIMIT + 3; n += 1) {
        await tokens.save(invite(`inv-${n}`, { email: `n${n}@example.test` }))
      }

      const result = await list(OWNER_A)

      expect(result.ok && result.value).toHaveLength(PENDING_INVITATIONS_LIMIT)
    })

    it('skips a row that names no role, which the store never returns for this query', async () => {
      const real = tokens.listAwaitingApproval.bind(tokens)
      tokens.listAwaitingApproval = async (...args) =>
        (await real(...args)).map((row) => ({ ...row, clientRole: null }))
      await tokens.save(invite('inv-odd'))

      expect(await list(OWNER_A)).toEqual({ ok: true, value: [] })
    })
  })

  describe('getEventLimits', () => {
    it('gives an event with no client the numbers it always had, without reading the clients', async () => {
      const unreadable = new FakeClientRepository()
      unreadable.contextForEvent = async () => {
        throw new Error('the clients table was read for an event with no client')
      }
      const event = anEvent({ quotaBytes: 5_000 })

      expect(await makeGetEventLimits({ clients: unreadable })({ event })).toEqual({
        quotaBytes: 5_000,
        liveWindowEnd: null,
      })
    })

    it('lowers the quota to the client’s ceiling, which an operator may have lowered since', async () => {
      clients.seed(aClient({ id: 'client-q', ceilings: { maxEventQuotaBytes: 2_000 } }))
      const event = anEvent({ id: 'e-q', quotaBytes: 5_000, clientId: 'client-q' })
      clients.linkEvent(event.id, asClientId('client-q'))

      expect((await makeGetEventLimits({ clients })({ event })).quotaBytes).toBe(2_000)
    })

    it('says when the live window closes, from the first opening', async () => {
      clients.seed(aClient({ id: 'client-w', ceilings: { maxLiveDays: 3 } }))
      const event = anEvent({ id: 'e-w', clientId: 'client-w', status: 'live', openedAt: AT })
      clients.linkEvent(event.id, asClientId('client-w'))

      expect((await makeGetEventLimits({ clients })({ event })).liveWindowEnd).toEqual(
        atPlus(3 * 24 * 60 * 60 * 1000),
      )
    })
  })
})
