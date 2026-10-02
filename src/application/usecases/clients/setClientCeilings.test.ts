import { beforeEach, describe, expect, it } from 'vitest'
import { asClientId, asUserId } from '../../../domain/shared/ids'
import type { AuditRecorder } from '../../ports/auditLog'
import { AT, aCeilingsSnapshot, aClient, atPlus } from '../../testing/builders'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { makeSetClientCeilings, type SetClientCeilings } from './setClientCeilings'

const CLIENT = asClientId('client-1')
const OPERATOR = { kind: 'operator', userId: asUserId('user-operator') } as const
const LATER = atPlus(7 * 86_400_000)

describe('setClientCeilings', () => {
  let clients: FakeClientRepository
  let audit: FakeAuditLog
  let clock: FakeClock
  let setClientCeilings: SetClientCeilings

  beforeEach(() => {
    clients = new FakeClientRepository().seed(
      aClient({
        id: 'client-1',
        ceilings: { maxEvents: 5, maxRetentionDays: 90, periodStartedAt: AT },
        eventsCreatedInPeriod: 4,
      }),
    )
    audit = new FakeAuditLog()
    clock = new FakeClock(LATER)
    setClientCeilings = makeSetClientCeilings({ clients, audit, clock })
  })

  const change = (ceilings: Parameters<SetClientCeilings>[0]['ceilings']) =>
    setClientCeilings({ clientId: CLIENT, ceilings, actor: OPERATOR })

  it('applies the ceiling it was given and stores it', async () => {
    const result = await change({ maxTotalBytes: 1_000 })

    expect(result.ok && result.value.ceilings.maxTotalBytes).toBe(1_000)
    expect((await clients.findById(CLIENT))?.ceilings.maxTotalBytes).toBe(1_000)
  })

  it('keeps every ceiling the patch does not mention, so raising one number lifts no other', async () => {
    await change({ maxTotalBytes: 1_000 })

    const stored = await clients.findById(CLIENT)
    expect(stored?.ceilings.maxEvents).toBe(5)
    expect(stored?.ceilings.maxRetentionDays).toBe(90)
  })

  it('removes a ceiling when the patch says null', async () => {
    await change({ maxEvents: null })

    expect((await clients.findById(CLIENT))?.ceilings.maxEvents).toBeNull()
  })

  it('answers client.notFound for a client that does not exist', async () => {
    const result = await setClientCeilings({
      clientId: asClientId('ghost'),
      ceilings: { maxEvents: 1 },
      actor: OPERATOR,
    })

    expect(!result.ok && result.error.code).toBe('client.notFound')
  })

  it('refuses a ceiling outside the catalogue bounds, and keeps the old ones', async () => {
    const result = await change({ maxEvents: 0 })

    expect(!result.ok && result.error.code).toBe('clientCeilings.maxEventsInvalid')
    expect((await clients.findById(CLIENT))?.ceilings.maxEvents).toBe(5)
  })

  // ------------------------------------------------------ the per-period counter --

  it('leaves the per-period counter alone on an ordinary edit', async () => {
    await change({ maxEvents: 6 })

    expect((await clients.findById(CLIENT))?.eventsCreatedInPeriod).toBe(4)
  })

  it('leaves the counter alone when the patch restates the same period instant', async () => {
    await change({ periodStartedAt: new Date(AT) })

    expect((await clients.findById(CLIENT))?.eventsCreatedInPeriod).toBe(4)
  })

  it('resets the counter to zero when the period is renewed', async () => {
    const result = await change({ periodStartedAt: atPlus(86_400_000) })

    expect(result.ok && result.value.eventsCreatedInPeriod).toBe(0)
    expect((await clients.findById(CLIENT))?.eventsCreatedInPeriod).toBe(0)
  })

  // ------------------------------------------------------------------ the audit --

  describe('the audit trail (roadmap 10.8)', () => {
    it('writes client.ceilingsChanged with the full before and after, who did it, and when', async () => {
      await change({ maxEvents: 6 })

      expect(audit.all()).toEqual([
        {
          seq: 1,
          at: LATER,
          actor: { kind: 'operator', userId: OPERATOR.userId, label: null },
          action: 'client.ceilingsChanged',
          subject: { type: 'client', id: 'client-1' },
          clientId: CLIENT,
          details: {
            before: aCeilingsSnapshot({
              maxEvents: 5,
              maxRetentionDays: 90,
              periodStartedAt: '2026-06-20T21:00:00.000Z',
            }),
            after: aCeilingsSnapshot({
              maxEvents: 6,
              maxRetentionDays: 90,
              periodStartedAt: '2026-06-20T21:00:00.000Z',
            }),
          },
        },
      ])
    })

    it('stamps the entry with the injected clock and not with the instant the client was created', async () => {
      await change({ maxEvents: 6 })

      expect(audit.all()[0]?.at).toEqual(LATER)
    })

    it('records a ceiling that was removed as null on the after side', async () => {
      await change({ maxEvents: null })

      expect(audit.all()[0]?.details).toMatchObject({
        before: { maxEvents: 5 },
        after: { maxEvents: null },
      })
    })

    it('writes nothing when the patch changes nothing, so a restated ceiling is not an act on the client', async () => {
      await change({ maxEvents: 5 })
      await change({})

      expect(audit.all()).toEqual([])
    })

    it('writes nothing for a client that does not exist', async () => {
      await setClientCeilings({
        clientId: asClientId('ghost'),
        ceilings: { maxEvents: 1 },
        actor: OPERATOR,
      })

      expect(audit.all()).toEqual([])
    })

    it('writes nothing for a ceiling the catalogue refuses', async () => {
      await change({ maxEvents: 0 })

      expect(audit.all()).toEqual([])
    })

    it('does not write client.periodReset for an ordinary edit that leaves the period alone', async () => {
      await change({ maxEvents: 6 })

      expect(audit.all().map((record) => record.action)).toEqual(['client.ceilingsChanged'])
    })

    it('writes client.periodReset after client.ceilingsChanged when the period is renewed, with the counter on both sides', async () => {
      await change({ periodStartedAt: atPlus(86_400_000) })

      expect(audit.all().map((record) => record.action)).toEqual([
        'client.ceilingsChanged',
        'client.periodReset',
      ])
      expect(audit.all()[1]?.details).toEqual({
        before: { periodStartedAt: '2026-06-20T21:00:00.000Z', eventsCreatedInPeriod: 4 },
        after: { periodStartedAt: '2026-06-21T21:00:00.000Z', eventsCreatedInPeriod: 0 },
      })
    })

    it('attributes the change to an integration as readily as to an operator', async () => {
      await setClientCeilings({
        clientId: CLIENT,
        ceilings: { maxEvents: 6 },
        actor: { kind: 'integration', label: 'cloud:stripe-webhook' },
      })

      expect(audit.all()[0]?.actor).toEqual({
        kind: 'integration',
        userId: null,
        label: 'cloud:stripe-webhook',
      })
    })

    it('refuses an actor that makes no sense, and changes nothing: no ceiling moves without a name behind it', async () => {
      const result = await setClientCeilings({
        clientId: CLIENT,
        ceilings: { maxEvents: 6 },
        actor: { kind: 'operator' },
      })

      expect(!result.ok && result.error.code).toBe('audit.actorUserRequired')
      expect((await clients.findById(CLIENT))?.ceilings.maxEvents).toBe(5)
      expect(audit.all()).toEqual([])
    })

    it('does not swallow a failure to write the audit entry', async () => {
      const broken: AuditRecorder = {
        record: async () => {
          throw new Error('disk full')
        },
      }
      const failing = makeSetClientCeilings({ clients, audit: broken, clock })

      await expect(
        failing({ clientId: CLIENT, ceilings: { maxEvents: 6 }, actor: OPERATOR }),
      ).rejects.toThrow('disk full')
    })

    it('never calls a recorder for a change that is refused before it is applied', async () => {
      let written = 0
      const counting: AuditRecorder = {
        record: async () => {
          written += 1
        },
      }
      const guarded = makeSetClientCeilings({ clients, audit: counting, clock })

      await guarded({ clientId: asClientId('ghost'), ceilings: {}, actor: OPERATOR })
      await guarded({ clientId: CLIENT, ceilings: { maxEvents: -1 }, actor: OPERATOR })

      expect(written).toBe(0)
    })
  })
})
